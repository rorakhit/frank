package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DebtCoachRecord struct {
	ID          string          `json:"id"`
	Payload     json.RawMessage `json:"payload"`
	GeneratedAt time.Time       `json:"generated_at"`
}

// SaveDebtCoach replaces any existing strategy with a single new row.
func SaveDebtCoach(ctx context.Context, pool *pgxpool.Pool, payload any) (DebtCoachRecord, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return DebtCoachRecord{}, fmt.Errorf("marshal debt coach payload: %w", err)
	}

	// Keep only the latest — truncate then insert.
	if _, err := pool.Exec(ctx, `TRUNCATE debt_coach`); err != nil {
		return DebtCoachRecord{}, fmt.Errorf("truncate debt_coach: %w", err)
	}

	var rec DebtCoachRecord
	err = pool.QueryRow(ctx, `
		INSERT INTO debt_coach (payload) VALUES ($1)
		RETURNING id, payload, generated_at
	`, b).Scan(&rec.ID, &rec.Payload, &rec.GeneratedAt)
	if err != nil {
		return DebtCoachRecord{}, fmt.Errorf("insert debt coach: %w", err)
	}
	return rec, nil
}

// LoadDebtCoach returns the most recent strategy, or nil if none exists.
func LoadDebtCoach(ctx context.Context, pool *pgxpool.Pool) (*DebtCoachRecord, error) {
	var rec DebtCoachRecord
	err := pool.QueryRow(ctx, `
		SELECT id, payload, generated_at FROM debt_coach ORDER BY generated_at DESC LIMIT 1
	`).Scan(&rec.ID, &rec.Payload, &rec.GeneratedAt)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("load debt coach: %w", err)
	}
	return &rec, nil
}
