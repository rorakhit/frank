package insights

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type stubAnalyzer struct {
	result AnalysisResult
	err    error
}

func (s *stubAnalyzer) Analyze(_ context.Context, _ AnalysisRequest) (AnalysisResult, error) {
	return s.result, s.err
}

func validJSON(analysis string, findings ...string) string {
	if len(findings) == 0 {
		findings = []string{"finding one"}
	}
	encoded := `"` + strings.Join(findings, `","`) + `"`
	return `{"raw_analysis":"` + analysis + `","key_findings":[` + encoded + `]}`
}

func testPeriod() PeriodSummary {
	return PeriodSummary{
		PeriodType: "biweekly",
		Start:      time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		End:        time.Date(2026, 5, 14, 0, 0, 0, 0, time.UTC),
	}
}

func TestGenerate_HappyPath(t *testing.T) {
	stub := &stubAnalyzer{result: AnalysisResult{
		Text:         validJSON("Good month.", "Spent less on food"),
		StopReason:   "end_turn",
		InputTokens:  100,
		OutputTokens: 50,
	}}
	result, record, err := Generate(context.Background(), stub, Config{Model: "test-model"}, testPeriod())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.RawAnalysis != "Good month." {
		t.Errorf("RawAnalysis = %q", result.RawAnalysis)
	}
	if len(result.KeyFindings) != 1 || result.KeyFindings[0] != "Spent less on food" {
		t.Errorf("KeyFindings = %v", result.KeyFindings)
	}
	if record.Model != "test-model" {
		t.Errorf("record.Model = %q", record.Model)
	}
}

func TestGenerate_ThinkingTextPropagated(t *testing.T) {
	stub := &stubAnalyzer{result: AnalysisResult{
		Text:         validJSON("Analysis."),
		ThinkingText: "my reasoning here",
		StopReason:   "end_turn",
	}}
	_, record, err := Generate(context.Background(), stub, Config{Model: "m", ThinkingBudget: 5000}, testPeriod())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if record.Output.ThinkingText != "my reasoning here" {
		t.Errorf("ThinkingText = %q", record.Output.ThinkingText)
	}
	if record.Input.ThinkingBudget != 5000 {
		t.Errorf("ThinkingBudget = %d", record.Input.ThinkingBudget)
	}
}

func TestGenerate_AnalyzerError(t *testing.T) {
	stub := &stubAnalyzer{err: errors.New("api down")}
	_, _, err := Generate(context.Background(), stub, Config{Model: "m"}, testPeriod())
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "api down") {
		t.Errorf("error = %v", err)
	}
}

func TestGenerate_BadJSONFromAnalyzer(t *testing.T) {
	stub := &stubAnalyzer{result: AnalysisResult{Text: "this is not json"}}
	_, _, err := Generate(context.Background(), stub, Config{Model: "m"}, testPeriod())
	if err == nil {
		t.Fatal("expected error for invalid JSON response, got nil")
	}
	if !strings.Contains(err.Error(), "parse insight JSON") {
		t.Errorf("error should mention parse context, got: %v", err)
	}
}

func TestGenerate_DefaultsEmptyConfig(t *testing.T) {
	stub := &stubAnalyzer{result: AnalysisResult{Text: validJSON("X")}}
	// Empty Config — all zero values
	_, record, err := Generate(context.Background(), stub, Config{}, testPeriod())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if record.Model != DefaultModel {
		t.Errorf("expected default model %q, got %q", DefaultModel, record.Model)
	}
	if record.Input.MaxTokens != DefaultMaxTokens {
		t.Errorf("expected default max tokens %d, got %d", DefaultMaxTokens, record.Input.MaxTokens)
	}
	if record.Input.Temperature != DefaultTemperature {
		t.Errorf("expected default temperature %f, got %f", DefaultTemperature, record.Input.Temperature)
	}
}

func TestGenerate_EvalRecordPopulated(t *testing.T) {
	stub := &stubAnalyzer{result: AnalysisResult{
		Text:                     validJSON("X"),
		StopReason:               "end_turn",
		InputTokens:              200,
		OutputTokens:             80,
		CacheCreationInputTokens: 150,
		CacheReadInputTokens:     50,
	}}
	p := testPeriod()
	_, record, err := Generate(context.Background(), stub, Config{Model: "claude-test", MaxTokens: 1024, Temperature: 0.5}, p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if record.PeriodType != "biweekly" {
		t.Errorf("PeriodType = %q", record.PeriodType)
	}
	if !record.PeriodStart.Equal(p.Start) {
		t.Errorf("PeriodStart = %v", record.PeriodStart)
	}
	if record.Output.InputTokens != 200 {
		t.Errorf("InputTokens = %d", record.Output.InputTokens)
	}
	if record.Output.CacheCreationInputTokens != 150 {
		t.Errorf("CacheCreationInputTokens = %d", record.Output.CacheCreationInputTokens)
	}
	if record.Output.CacheReadInputTokens != 50 {
		t.Errorf("CacheReadInputTokens = %d", record.Output.CacheReadInputTokens)
	}
	if record.Input.Temperature != 0.5 {
		t.Errorf("Temperature = %f", record.Input.Temperature)
	}
	if record.ID == "" {
		t.Error("record.ID should not be empty")
	}
}

func TestParseInsightResponse_BareJSON(t *testing.T) {
	input := `{"raw_analysis": "Spending was reasonable.", "key_findings": ["Finding one", "Finding two"]}`
	got, err := ParseInsightResponse(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.RawAnalysis != "Spending was reasonable." {
		t.Errorf("raw_analysis = %q", got.RawAnalysis)
	}
	if len(got.KeyFindings) != 2 || got.KeyFindings[0] != "Finding one" {
		t.Errorf("key_findings = %v", got.KeyFindings)
	}
}

func TestParseInsightResponse_FencedJSON(t *testing.T) {
	input := "```json\n{\"raw_analysis\": \"Good month.\", \"key_findings\": [\"A\"]}\n```"
	got, err := ParseInsightResponse(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.RawAnalysis != "Good month." {
		t.Errorf("raw_analysis = %q", got.RawAnalysis)
	}
}

func TestParseInsightResponse_FencedNoLang(t *testing.T) {
	input := "```\n{\"raw_analysis\": \"Fine.\", \"key_findings\": []}\n```"
	got, err := ParseInsightResponse(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.RawAnalysis != "Fine." {
		t.Errorf("raw_analysis = %q", got.RawAnalysis)
	}
}

func TestParseInsightResponse_WithLeadingTrailingWhitespace(t *testing.T) {
	input := "\n\n  {\"raw_analysis\": \"OK.\", \"key_findings\": [\"X\"]}  \n"
	got, err := ParseInsightResponse(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.RawAnalysis != "OK." {
		t.Errorf("raw_analysis = %q", got.RawAnalysis)
	}
}

func TestParseInsightResponse_EmptyKeyFindings(t *testing.T) {
	input := `{"raw_analysis": "Quiet period.", "key_findings": []}`
	got, err := ParseInsightResponse(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got.KeyFindings) != 0 {
		t.Errorf("expected empty key_findings, got %v", got.KeyFindings)
	}
}

func TestParseInsightResponse_InvalidJSON(t *testing.T) {
	_, err := ParseInsightResponse("this is not json")
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
	if !strings.Contains(err.Error(), "parse insight JSON") {
		t.Errorf("error should mention parse context, got: %v", err)
	}
}

func TestParseInsightResponse_MissingFields(t *testing.T) {
	// Valid JSON but missing both fields — should parse without error, fields zero-valued
	got, err := ParseInsightResponse(`{}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.RawAnalysis != "" {
		t.Errorf("expected empty raw_analysis, got %q", got.RawAnalysis)
	}
	if got.KeyFindings != nil {
		t.Errorf("expected nil key_findings, got %v", got.KeyFindings)
	}
}

func TestParseInsightResponse_MultipleKeyFindings(t *testing.T) {
	input := `{"raw_analysis": "X", "key_findings": ["A", "B", "C", "D", "E"]}`
	got, err := ParseInsightResponse(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got.KeyFindings) != 5 {
		t.Errorf("expected 5 key findings, got %d", len(got.KeyFindings))
	}
	if got.KeyFindings[4] != "E" {
		t.Errorf("last finding = %q, want E", got.KeyFindings[4])
	}
}
