package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/charmbracelet/log"
	"github.com/spf13/cobra"

	"board-games/pkg/config"
	"board-games/pkg/server"
)

var cfgFile string
var invPath string
var githubToken string

var rootCmd = &cobra.Command{
    Use:   "boardgames-server",
    Short: "Run board-games HTTP server",
    RunE: func(cmd *cobra.Command, args []string) error {
        logger := log.NewWithOptions(os.Stderr, log.Options{ReportTimestamp: true})
        cfg, err := config.Build(cfgFile, cmd.Flags())
        if err != nil {
            return err
        }
        if invPath != "" { cfg.InventoryPath = invPath }
        if githubToken != "" { cfg.GitHub.Token = githubToken }
        if cfg.InventoryPath == "" && cfg.GitHub.Token == "" {
            return fmt.Errorf("either -f/--inventory_path or --github-token must be provided")
        }
        if cfg.InventoryPath != "" {
            logger.Warn("FILE mode (debug only)", "path", cfg.InventoryPath)
        } else {
            logger.Info("GITHUB mode", "owner", cfg.GitHub.Owner, "repo", cfg.GitHub.Repo, "path", cfg.GitHub.Path, "ref", cfg.GitHub.Ref, "interval_s", cfg.GitHub.IntervalSeconds)
        }
        srv := server.New(cfg, logger)
        addr := fmt.Sprintf("0.0.0.0:%s", cfg.Port)
        logger.Info("starting server", "addr", addr)
        return http.ListenAndServe(addr, srv)
    },
}

func init() {
    rootCmd.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "Config file (default is config.yaml)")
    rootCmd.Flags().String("port", "", "Server port (overrides config")
    rootCmd.Flags().StringVarP(&invPath, "inventory_path", "f", "", "Path to inventory YAML file")
    rootCmd.Flags().StringVar(&githubToken, "github-token", "", "GitHub token for polling remote inventory")
}

func main() {
    if err := rootCmd.Execute(); err != nil {
        fmt.Println(err)
        os.Exit(1)
    }
}


