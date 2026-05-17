package insights

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/rorakhit/frank/internal/evals"
)

const (
	DefaultModel          = "claude-sonnet-4-6"
	DefaultMaxTokens      = 4096
	DefaultTemperature    = 1.0
	DefaultThinkingBudget = 5000
)

type Config struct {
	APIKey         string
	Model          string
	MaxTokens      int
	Temperature    float64
	ThinkingBudget int // 0 disables extended thinking; minimum effective value is 1024
}

type Result struct {
	RawAnalysis string
	KeyFindings []string
}

// insightJSON is the JSON structure Claude is instructed to return.
type insightJSON struct {
	RawAnalysis string   `json:"raw_analysis"`
	KeyFindings []string `json:"key_findings"`
}

// ParseInsightResponse extracts the insight JSON from Claude's raw text response.
// Claude may wrap the JSON in a markdown code fence; this handles both forms.
func ParseInsightResponse(text string) (insightJSON, error) {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "```") {
		text = strings.TrimPrefix(text, "```json")
		text = strings.TrimPrefix(text, "```")
		if idx := strings.LastIndex(text, "```"); idx >= 0 {
			text = text[:idx]
		}
		text = strings.TrimSpace(text)
	}
	var parsed insightJSON
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return insightJSON{}, fmt.Errorf("parse insight JSON: %w\nraw: %s", err, text)
	}
	return parsed, nil
}

func Generate(ctx context.Context, analyzer Analyzer, cfg Config, period PeriodSummary) (Result, evals.Record, error) {
	if cfg.Model == "" {
		cfg.Model = DefaultModel
	}
	if cfg.MaxTokens == 0 {
		cfg.MaxTokens = DefaultMaxTokens
	}
	if cfg.Temperature == 0 {
		cfg.Temperature = DefaultTemperature
	}

	systemPrompt, userPrompt := BuildPrompts(period)

	req := AnalysisRequest{
		SystemPrompt:   systemPrompt,
		UserPrompt:     userPrompt,
		Model:          cfg.Model,
		MaxTokens:      cfg.MaxTokens,
		Temperature:    cfg.Temperature,
		ThinkingBudget: cfg.ThinkingBudget,
	}

	analysisResult, err := analyzer.Analyze(ctx, req)
	if err != nil {
		return Result{}, evals.Record{}, err
	}

	parsed, err := ParseInsightResponse(analysisResult.Text)
	if err != nil {
		return Result{}, evals.Record{}, err
	}

	result := Result{
		RawAnalysis: parsed.RawAnalysis,
		KeyFindings: parsed.KeyFindings,
	}

	evalIn := evals.Input{
		SystemPrompt:   systemPrompt,
		UserPrompt:     userPrompt,
		Temperature:    cfg.Temperature,
		MaxTokens:      cfg.MaxTokens,
		ThinkingBudget: cfg.ThinkingBudget,
	}
	evalOut := evals.Output{
		RawAnalysis:              parsed.RawAnalysis,
		KeyFindings:              parsed.KeyFindings,
		ThinkingText:             analysisResult.ThinkingText,
		StopReason:               analysisResult.StopReason,
		InputTokens:              analysisResult.InputTokens,
		OutputTokens:             analysisResult.OutputTokens,
		CacheCreationInputTokens: analysisResult.CacheCreationInputTokens,
		CacheReadInputTokens:     analysisResult.CacheReadInputTokens,
	}
	record := evals.NewRecord(cfg.Model, period.PeriodType, period.Start, period.End, evalIn, evalOut)

	return result, record, nil
}
