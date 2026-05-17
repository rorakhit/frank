package evals

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
)

type Input struct {
	SystemPrompt   string  `json:"system_prompt"`
	UserPrompt     string  `json:"user_prompt"`
	Temperature    float64 `json:"temperature"`
	MaxTokens      int     `json:"max_tokens"`
	ThinkingBudget int     `json:"thinking_budget"` // 0 means thinking was disabled
}

type Output struct {
	RawAnalysis              string   `json:"raw_analysis"`
	KeyFindings              []string `json:"key_findings"`
	ThinkingText             string   `json:"thinking_text"` // empty when thinking was disabled
	StopReason               string   `json:"stop_reason"`
	InputTokens              int      `json:"input_tokens"`
	OutputTokens             int      `json:"output_tokens"`
	CacheCreationInputTokens int      `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int      `json:"cache_read_input_tokens"`
}

type Record struct {
	ID          string    `json:"id"`
	RanAt       time.Time `json:"ran_at"`
	Model       string    `json:"model"`
	PeriodType  string    `json:"period_type"`
	PeriodStart time.Time `json:"period_start"`
	PeriodEnd   time.Time `json:"period_end"`
	Input       Input     `json:"input"`
	Output      Output    `json:"output"`
	Score       *float64  `json:"score"`
	Notes       string    `json:"notes"`
}

func NewRecord(model, periodType string, periodStart, periodEnd time.Time, in Input, out Output) Record {
	return Record{
		ID:          uuid.New().String(),
		RanAt:       time.Now().UTC(),
		Model:       model,
		PeriodType:  periodType,
		PeriodStart: periodStart,
		PeriodEnd:   periodEnd,
		Input:       in,
		Output:      out,
		Score:       nil,
		Notes:       "",
	}
}

// Append writes one eval record as a JSON line to dataDir/evals/<timestamp>_insights.jsonl.
// Pass the same runFile path across calls within one run to append to the same file.
func Append(record Record, runFile string) error {
	if err := os.MkdirAll(filepath.Dir(runFile), 0o755); err != nil {
		return fmt.Errorf("evals mkdir: %w", err)
	}
	f, err := os.OpenFile(runFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("evals open: %w", err)
	}
	defer f.Close()

	line, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("evals marshal: %w", err)
	}
	_, err = fmt.Fprintf(f, "%s\n", line)
	return err
}

// RunFile returns the path for this run's eval file given a data directory and run start time.
func RunFile(dataDir string, runAt time.Time) string {
	name := fmt.Sprintf("%s_insights.jsonl", runAt.UTC().Format("20060102_150405"))
	return filepath.Join(dataDir, "evals", name)
}
