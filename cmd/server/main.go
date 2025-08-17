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
var dbPath string

var rootCmd = &cobra.Command{
    Use:   "boardgames-server",
    Short: "Run board-games HTTP server",
    RunE: func(cmd *cobra.Command, args []string) error {
        logger := log.NewWithOptions(os.Stderr, log.Options{ReportTimestamp: true})
        cfg, err := config.Build(cfgFile, cmd.Flags())
        if err != nil {
            return err
        }
        if os.Getenv("BOARDGAMES_TOKEN") == "" {
            return fmt.Errorf("BOARDGAMES_TOKEN not set")
        }
        if dbPath != "" {
            cfg.DBPath = dbPath
        }
        logger.Info("DB mode", "db", cfg.DBPath)
        srv := server.New(cfg, logger)
        addr := fmt.Sprintf("0.0.0.0:%s", cfg.Port)
        logger.Info("starting server", "addr", addr)
        return http.ListenAndServe(addr, srv)
    },
}

func init() {
    rootCmd.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "Config file (default is config.yaml)")
    rootCmd.Flags().String("port", "", "Server port (overrides config")
    rootCmd.Flags().StringVarP(&dbPath, "db", "d", "", "Path to SQLite database file (default ./boardgames.db)")
}

func main() {
    if err := rootCmd.Execute(); err != nil {
        fmt.Println(err)
        os.Exit(1)
    }
}


