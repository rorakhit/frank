package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"log"
	"net/smtp"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"
)

type scraper struct {
	source string
	script string
}

var scrapers = []scraper{
	{"affinity_fcu", "scrapers/affinity_fcu.py"},
	{"sofi", "scrapers/sofi.py"},
	{"chase", "scrapers/chase.py"},
}

func main() {
	days := flag.Int("days", 30, "Days of history to fetch")
	flag.Parse()

	root := projectRoot()

	etlBin := filepath.Join(root, "bin", "frank-etl")
	if _, err := os.Stat(etlBin); err != nil {
		log.Fatalf("frank-etl binary not found at %s — run 'make build' first", etlBin)
	}

	g, ctx := errgroup.WithContext(context.Background())

	for _, s := range scrapers {
		s := s
		g.Go(func() error {
			return runOne(ctx, root, etlBin, s.source, s.script, *days)
		})
	}

	if err := g.Wait(); err != nil {
		msg := fmt.Sprintf("frank scrape failed at %s: %v\n\nCheck ~/Library/Logs/frank/scrape-error.log for details.",
			time.Now().Format(time.RFC3339), err)
		if alertErr := sendEmail("[frank] Scrape failed", msg); alertErr != nil {
			log.Printf("alert email failed: %v", alertErr)
		}
		log.Fatalf("scrape: %v", err)
	}

	sources := make([]string, len(scrapers))
	for i, s := range scrapers {
		sources[i] = s.source
	}
	msg := fmt.Sprintf("All scrapers completed successfully at %s.\n\nSources: %s\nDays fetched: %d",
		time.Now().Format(time.RFC3339), strings.Join(sources, ", "), *days)
	if err := sendEmail("[frank] Scrape succeeded", msg); err != nil {
		log.Printf("success email failed: %v", err)
	}
	fmt.Println("All scrapers and ETL runs completed successfully.")
}

func runOne(ctx context.Context, root, etlBin, source, script string, days int) error {
	fmt.Printf("[%s] Starting scraper...\n", source)
	scrapeCmd := exec.CommandContext(ctx, "python3", filepath.Join(root, script), "--days", strconv.Itoa(days))
	scrapeCmd.Stdout = os.Stdout
	scrapeCmd.Stderr = os.Stderr
	if err := scrapeCmd.Run(); err != nil {
		return fmt.Errorf("%s scraper: %w", source, err)
	}

	fmt.Printf("[%s] Scraper done — running ETL...\n", source)
	etlCmd := exec.CommandContext(ctx, etlBin, "--source", source)
	etlCmd.Stdout = os.Stdout
	etlCmd.Stderr = os.Stderr
	if err := etlCmd.Run(); err != nil {
		return fmt.Errorf("%s etl: %w", source, err)
	}

	fmt.Printf("[%s] Done.\n", source)
	return nil
}

func sendEmail(subject, body string) error {
	user := os.Getenv("GMAIL_USER")
	password := os.Getenv("GMAIL_APP_PASSWORD")
	if user == "" || password == "" {
		return fmt.Errorf("GMAIL_USER or GMAIL_APP_PASSWORD not set")
	}

	msg := "From: " + user + "\r\n" +
		"To: " + user + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"\r\n" +
		body + "\r\n"

	auth := smtp.PlainAuth("", user, password, "smtp.gmail.com")
	tlsCfg := &tls.Config{ServerName: "smtp.gmail.com"}
	conn, err := tls.Dial("tcp", "smtp.gmail.com:465", tlsCfg)
	if err != nil {
		return fmt.Errorf("dial smtp: %w", err)
	}
	client, err := smtp.NewClient(conn, "smtp.gmail.com")
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Quit()

	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	if err := client.Mail(user); err != nil {
		return fmt.Errorf("smtp MAIL: %w", err)
	}
	if err := client.Rcpt(user); err != nil {
		return fmt.Errorf("smtp RCPT: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := fmt.Fprint(w, msg); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	return w.Close()
}

func projectRoot() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "."
	}
	return filepath.Join(filepath.Dir(filename), "..", "..")
}
