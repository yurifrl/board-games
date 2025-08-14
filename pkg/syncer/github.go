package syncer

import (
	"context"
	"encoding/base64"
	json "encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

type GitHubPoller struct {
    Client   *http.Client
    Token    string
    Owner    string
    Repo     string
    Path     string
    Ref      string
    ETag     string
    Interval time.Duration
}

func (p *GitHubPoller) url() string {
    ref := p.Ref
    if ref == "" { ref = "heads/main" }
    return "https://api.github.com/repos/" + p.Owner + "/" + p.Repo + "/contents/" + p.Path + "?ref=" + ref
}

func (p *GitHubPoller) PollOnce(ctx context.Context) ([]byte, string, error) {
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, p.url(), nil)
    if p.Token != "" { req.Header.Set("Authorization", "Bearer "+p.Token) }
    if p.ETag != "" { req.Header.Set("If-None-Match", p.ETag) }
    req.Header.Set("Accept", "application/vnd.github+json")
    resp, err := p.client().Do(req)
    if err != nil { return nil, p.ETag, err }
    defer resp.Body.Close()
    if resp.StatusCode == http.StatusNotModified { return nil, p.ETag, nil }
    if resp.StatusCode != http.StatusOK { return nil, p.ETag, errors.New(resp.Status) }
    body, _ := io.ReadAll(resp.Body)
    etag := resp.Header.Get("ETag")
    // Minimal decode of content field to raw bytes
    // Schema: { content: base64, encoding: "base64" }
    var content struct {
        Content  string `json:"content"`
        Encoding string `json:"encoding"`
    }
    _ = json.Unmarshal(body, &content)
    if content.Encoding == "base64" {
        b, _ := base64.StdEncoding.DecodeString(stripNewlines(content.Content))
        return b, etag, nil
    }
    return nil, etag, errors.New("unsupported encoding")
}

func (p *GitHubPoller) Start(ctx context.Context, onChange func([]byte)) {
    ticker := time.NewTicker(p.interval())
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            b, etag, err := p.PollOnce(ctx)
            if err == nil && b != nil {
                p.ETag = etag
                onChange(b)
            }
        }
    }
}

func (p *GitHubPoller) client() *http.Client {
    if p.Client != nil { return p.Client }
    return &http.Client{Timeout: 10 * time.Second}
}

func (p *GitHubPoller) interval() time.Duration {
    if p.Interval > 0 { return p.Interval }
    return 10 * time.Second
}

func stripNewlines(s string) string {
    b := make([]byte, 0, len(s))
    for i := 0; i < len(s); i++ {
        if s[i] == '\n' || s[i] == '\r' { continue }
        b = append(b, s[i])
    }
    return string(b)
}

