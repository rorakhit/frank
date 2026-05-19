package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	pool, err := pgxpool.New(context.Background(), os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	ctx := context.Background()

	_, err = pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())`)
	if err != nil {
		log.Fatal(err)
	}

	already := []string{
		"001_core",
		"002_transactions",
		"003_financial_metadata",
		"004_categorization",
		"005_paycheck_and_reports",
		"006_scrape_runs",
		"007_loans",
		"008_insights_and_goals",
	}
	for _, v := range already {
		_, err = pool.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`, v)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println("seeded", v)
	}
}
