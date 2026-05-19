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

	tag, err := pool.Exec(context.Background(), `
		UPDATE transactions SET is_internal = true
		WHERE raw_type IN (
			'DEPOSIT_VAULT','DEPOSIT_VAULT_SCHEDULED',
			'WITHDRAWAL_VAULT','WITHDRAWAL_VAULT_SCHEDULED',
			'INTERNAL_TRANSFER','TRANSFER_CREDIT'
		) OR description ILIKE '%RoundUps Vault%'`)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("flagged %d rows as internal\n", tag.RowsAffected())

	var total int
	pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE is_internal = true`).Scan(&total)
	fmt.Printf("total internal: %d\n", total)
}
