package insights

import (
	"context"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// ClaudeAnalyzer implements Analyzer using the official Anthropic Go SDK.
type ClaudeAnalyzer struct {
	client *anthropic.Client
}

func NewClaudeAnalyzer(apiKey string) *ClaudeAnalyzer {
	c := anthropic.NewClient(
		option.WithAPIKey(apiKey),
		option.WithHeaderAdd("anthropic-beta", "prompt-caching-2024-07-31"),
	)
	return &ClaudeAnalyzer{client: &c}
}

func (a *ClaudeAnalyzer) Analyze(ctx context.Context, req AnalysisRequest) (AnalysisResult, error) {
	system := []anthropic.TextBlockParam{
		{
			Text:         req.SystemPrompt,
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
		},
	}

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(req.Model),
		MaxTokens: int64(req.MaxTokens),
		System:    system,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(req.UserPrompt)),
		},
	}

	if req.Temperature != 0 {
		params.Temperature = anthropic.Float(req.Temperature)
	}

	if req.ThinkingBudget > 0 {
		params.Thinking = anthropic.ThinkingConfigParamOfEnabled(int64(req.ThinkingBudget))
	}

	msg, err := a.client.Messages.New(ctx, params)
	if err != nil {
		return AnalysisResult{}, fmt.Errorf("claude api: %w", err)
	}

	var result AnalysisResult
	result.StopReason = string(msg.StopReason)
	result.InputTokens = int(msg.Usage.InputTokens)
	result.OutputTokens = int(msg.Usage.OutputTokens)
	result.CacheCreationInputTokens = int(msg.Usage.CacheCreationInputTokens)
	result.CacheReadInputTokens = int(msg.Usage.CacheReadInputTokens)

	for _, block := range msg.Content {
		switch block.Type {
		case "thinking":
			result.ThinkingText = block.Thinking
		case "text":
			result.Text = block.Text
		default:
			fmt.Printf("[insights] unexpected content block type: %q\n", block.Type)
		}
	}

	return result, nil
}
