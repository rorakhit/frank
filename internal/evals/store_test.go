package evals

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var testTime = time.Date(2026, 5, 16, 14, 23, 0, 0, time.UTC)

func makeRecord(model, periodType string) Record {
	return NewRecord(
		model,
		periodType,
		time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 5, 14, 0, 0, 0, 0, time.UTC),
		Input{
			SystemPrompt: "system",
			UserPrompt:   "user",
			Temperature:  1.0,
			MaxTokens:    4096,
		},
		Output{
			RawAnalysis:  "Good period.",
			KeyFindings:  []string{"Finding A", "Finding B"},
			StopReason:   "end_turn",
			InputTokens:  100,
			OutputTokens: 200,
		},
	)
}

func TestNewRecord_FieldsPopulated(t *testing.T) {
	r := makeRecord("claude-sonnet-4-6", "biweekly")

	if r.ID == "" {
		t.Error("ID should not be empty")
	}
	if r.Model != "claude-sonnet-4-6" {
		t.Errorf("Model = %q", r.Model)
	}
	if r.PeriodType != "biweekly" {
		t.Errorf("PeriodType = %q", r.PeriodType)
	}
	if r.Score != nil {
		t.Error("Score should be nil on a new record")
	}
	if r.Notes != "" {
		t.Error("Notes should be empty on a new record")
	}
	if r.RanAt.IsZero() {
		t.Error("RanAt should not be zero")
	}
}

func TestNewRecord_UniqueIDs(t *testing.T) {
	a := makeRecord("model", "biweekly")
	b := makeRecord("model", "biweekly")
	if a.ID == b.ID {
		t.Error("two records should have different IDs")
	}
}

func TestRunFile_Format(t *testing.T) {
	path := RunFile("/project/data", testTime)
	// Should be: /project/data/evals/20260516_142300_insights.jsonl
	if !strings.HasSuffix(path, ".jsonl") {
		t.Errorf("RunFile should end with .jsonl, got %q", path)
	}
	if !strings.Contains(path, "20260516_142300") {
		t.Errorf("RunFile should contain formatted timestamp, got %q", path)
	}
	if filepath.Base(filepath.Dir(path)) != "evals" {
		t.Errorf("RunFile should be inside an evals/ dir, got %q", path)
	}
}

func TestAppend_WritesValidJSONL(t *testing.T) {
	dir := t.TempDir()
	runFile := filepath.Join(dir, "evals", "test_insights.jsonl")

	r := makeRecord("claude-sonnet-4-6", "biweekly")
	if err := Append(r, runFile); err != nil {
		t.Fatalf("Append error: %v", err)
	}

	data, err := os.ReadFile(runFile)
	if err != nil {
		t.Fatalf("could not read file: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}

	var got Record
	if err := json.Unmarshal([]byte(lines[0]), &got); err != nil {
		t.Fatalf("line is not valid JSON: %v\nline: %s", err, lines[0])
	}
	if got.ID != r.ID {
		t.Errorf("ID mismatch: got %q, want %q", got.ID, r.ID)
	}
	if got.Output.RawAnalysis != "Good period." {
		t.Errorf("RawAnalysis = %q", got.Output.RawAnalysis)
	}
}

func TestAppend_MultipleRecordsOneLineEach(t *testing.T) {
	dir := t.TempDir()
	runFile := filepath.Join(dir, "evals", "test.jsonl")

	for i := 0; i < 3; i++ {
		if err := Append(makeRecord("model", "biweekly"), runFile); err != nil {
			t.Fatalf("Append %d error: %v", i, err)
		}
	}

	f, err := os.Open(runFile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer f.Close()

	lineCount := 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var r Record
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			t.Errorf("line %d is not valid JSON: %v", lineCount+1, err)
		}
		lineCount++
	}
	if lineCount != 3 {
		t.Errorf("expected 3 JSONL lines, got %d", lineCount)
	}
}

func TestAppend_CreatesIntermediateDirs(t *testing.T) {
	dir := t.TempDir()
	runFile := filepath.Join(dir, "deeply", "nested", "evals", "test.jsonl")

	if err := Append(makeRecord("model", "monthly"), runFile); err != nil {
		t.Fatalf("Append should create intermediate dirs: %v", err)
	}
	if _, err := os.Stat(runFile); err != nil {
		t.Errorf("file not created: %v", err)
	}
}

func TestAppend_CacheTokensPreserved(t *testing.T) {
	dir := t.TempDir()
	runFile := filepath.Join(dir, "test.jsonl")

	r := NewRecord("model", "biweekly",
		time.Now(), time.Now(),
		Input{SystemPrompt: "s", UserPrompt: "u", Temperature: 1, MaxTokens: 100},
		Output{
			CacheCreationInputTokens: 42,
			CacheReadInputTokens:     7,
		},
	)
	if err := Append(r, runFile); err != nil {
		t.Fatalf("Append: %v", err)
	}

	data, _ := os.ReadFile(runFile)
	var got Record
	json.Unmarshal(data, &got)

	if got.Output.CacheCreationInputTokens != 42 {
		t.Errorf("CacheCreationInputTokens = %d, want 42", got.Output.CacheCreationInputTokens)
	}
	if got.Output.CacheReadInputTokens != 7 {
		t.Errorf("CacheReadInputTokens = %d, want 7", got.Output.CacheReadInputTokens)
	}
}
