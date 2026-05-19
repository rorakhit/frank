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

	sql, err := os.ReadFile(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}

	if _, err := pool.Exec(ctx, string(sql)); err != nil {
		log.Fatal(err)
	}
	fmt.Println("applied", os.Args[1])
}
