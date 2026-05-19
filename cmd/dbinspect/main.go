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

	rows, err := pool.Query(ctx, `
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_name = ANY($1)
		ORDER BY table_name, ordinal_position`,
		[]string{"categorization_rules", "transactions"})
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var col, typ, nullable string
		rows.Scan(&col, &typ, &nullable)
		fmt.Printf("%-30s %-20s %s\n", col, typ, nullable)
	}
}
