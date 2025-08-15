package ludopedia

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// FetchGameRaw returns the raw JSON payload for a Ludopedia game by slug or id.
func FetchGameRaw(slug string) ([]byte, error) {
    if slug == "" { return nil, fmt.Errorf("missing slug") }
    appID := os.Getenv("LUDOPEDIA_APP_ID")
    appKey := os.Getenv("LUDOPEDIA_APP_KEY")
    token := os.Getenv("LUDOPEDIA_ACCESS_TOKEN")
    if token == "" { token = os.Getenv("LUDOPEDIA_ACESS_TOKEN") }
    if appID == "" || appKey == "" || token == "" {
        return nil, fmt.Errorf("missing ludopedia credentials")
    }
    url := fmt.Sprintf("https://ludopedia.com.br/api/jogos/%s?app_id=%s&app_key=%s&access_token=%s", slug, appID, appKey, token)
    req, _ := http.NewRequest(http.MethodGet, url, nil)
    req.Header.Set("User-Agent", "board-games/1.0")
    client := &http.Client{Timeout: 10 * time.Second}
    resp, err := client.Do(req)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 { return nil, fmt.Errorf("ludopedia http %d", resp.StatusCode) }
    b, err := io.ReadAll(resp.Body)
    if err != nil { return nil, err }
    // validate it's JSON
    var tmp any
    if err := json.Unmarshal(b, &tmp); err != nil { return nil, fmt.Errorf("invalid json: %w", err) }
    return b, nil
}

// FetchGame returns a typed Ludopedia Jogo payload by id or slug.
func FetchGame(slug string) (*Jogo, error) {
    b, err := FetchGameRaw(slug)
    if err != nil { return nil, err }
    var j Jogo
    if err := json.Unmarshal(b, &j); err != nil { return nil, err }
    return &j, nil
}


