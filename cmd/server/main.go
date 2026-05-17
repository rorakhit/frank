package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rorakhit/frank/internal/db"
)

func main() {
	port := flag.String("port", "8080", "HTTP listen port")
	flag.Parse()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.CleanPath)

	r.Get("/health", handleHealth())
	r.Route("/api", func(r chi.Router) {
		r.Get("/institutions", handleListInstitutions(pool))
		r.Get("/transactions", handleListTransactions(pool))
	})

	log.Printf("frank server listening on :%s", *port)
	if err := http.ListenAndServe(":"+*port, r); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func handleHealth() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func handleListInstitutions(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		institutions, err := db.ListInstitutions(r.Context(), pool)
		if err != nil {
			log.Printf("list institutions: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		writeJSON(w, http.StatusOK, institutions)
	}
}

func handleListTransactions(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		end := time.Now()
		start := end.AddDate(0, 0, -30)

		if s := q.Get("start"); s != "" {
			t, err := time.Parse("2006-01-02", s)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid start date, use YYYY-MM-DD"})
				return
			}
			start = t
		}
		if e := q.Get("end"); e != "" {
			t, err := time.Parse("2006-01-02", e)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid end date, use YYYY-MM-DD"})
				return
			}
			end = t
		}

		txns, err := db.FetchTransactions(r.Context(), pool, start, end)
		if err != nil {
			log.Printf("fetch transactions: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		writeJSON(w, http.StatusOK, txns)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode response: %v", err)
	}
}
