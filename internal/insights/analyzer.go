package insights

import "context"

// Analyzer is the LLM dependency. Claude today, local model later.
type Analyzer interface {
	Analyze(ctx context.Context, req AnalysisRequest) (AnalysisResult, error)
}

type AnalysisRequest struct {
	SystemPrompt   string
	UserPrompt     string
	Model          string
	MaxTokens      int
	Temperature    float64
	ThinkingBudget int // 0 = disabled
}

type AnalysisResult struct {
	Text                     string
	ThinkingText             string
	StopReason               string
	InputTokens              int
	OutputTokens             int
	CacheCreationInputTokens int
	CacheReadInputTokens     int
}
