// Package testdb provides a helper for integration tests that need a real Postgres database.
//
// It creates a throwaway database named "frank_test_<random>" against the local Docker Postgres,
// runs all migrations, and drops the database when the test is done.
//
// Tests using this package are skipped automatically when Postgres is unreachable,
// so they never block CI or a developer who hasn't started Docker.
//
// Usage:
//
//	func TestSomething(t *testing.T) {
//	    pool := testdb.New(t)
//	    // use pool ...
//	}
package testdb

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const baseURL = "postgresql://frank:frank@localhost:5432"

// New creates a throwaway test database, runs all up migrations, and registers cleanup.
// If Postgres is unreachable the test is skipped rather than failed.
func New(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()

	dbName := fmt.Sprintf("frank_test_%d", rand.Int63())

	// Connect to the default "frank" DB to create the test DB
	adminPool, err := pgxpool.New(ctx, baseURL+"/frank?sslmode=disable")
	if err != nil || adminPool.Ping(ctx) != nil {
		t.Skip("postgres unreachable — skipping integration test")
	}

	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+dbName); err != nil {
		adminPool.Close()
		t.Fatalf("create test db: %v", err)
	}
	adminPool.Close()

	testDSN := fmt.Sprintf("%s/%s?sslmode=disable", baseURL, dbName)
	pool, err := pgxpool.New(ctx, testDSN)
	if err != nil {
		dropDB(dbName)
		t.Fatalf("connect to test db: %v", err)
	}

	if err := runMigrations(ctx, pool); err != nil {
		pool.Close()
		dropDB(dbName)
		t.Fatalf("migrations: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
		dropDB(dbName)
	})

	return pool
}

func runMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	migrationsDir := migrationsPath()
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("read migrations dir %s: %w", migrationsDir, err)
	}

	var upFiles []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".up.sql") {
			upFiles = append(upFiles, filepath.Join(migrationsDir, e.Name()))
		}
	}
	sort.Strings(upFiles)

	for _, f := range upFiles {
		sql, err := os.ReadFile(f)
		if err != nil {
			return fmt.Errorf("read %s: %w", f, err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("exec %s: %w", f, err)
		}
	}
	return nil
}

func dropDB(name string) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, baseURL+"/frank?sslmode=disable")
	if err != nil {
		return
	}
	defer pool.Close()
	// Terminate any lingering connections before dropping
	pool.Exec(ctx, fmt.Sprintf(
		"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s'", name,
	))
	pool.Exec(ctx, "DROP DATABASE IF EXISTS "+name)
}

// migrationsPath resolves internal/db/migrations relative to this source file.
func migrationsPath() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "internal/db/migrations"
	}
	// filename: .../internal/testdb/testdb.go → up two levels → internal/ → db/migrations
	return filepath.Join(filepath.Dir(filename), "..", "db", "migrations")
}
