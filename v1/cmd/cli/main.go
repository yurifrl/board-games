package main

import (
	"fmt"
	"os"

	"github.com/charmbracelet/log"
	"github.com/spf13/cobra"

	"board-games/pkg/config"
	"board-games/pkg/store"
)

var cfgFile string

var rootCmd = &cobra.Command{
    Use:   "boardgames",
    Short: "Board games CLI",
    RunE: func(cmd *cobra.Command, args []string) error {
        logger := log.NewWithOptions(os.Stderr, log.Options{})
        _ = logger
        cfg, err := config.Build(cfgFile, cmd.Flags())
        if err != nil {
            return err
        }
        st, err := store.New(cfg.DBPath)
        if err != nil {
            return err
        }
        for _, g := range st.List() {
            fmt.Printf("%s | %s\n", g.ID, g.Name)
        }
        return nil
    },
}

func init() {
    rootCmd.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "Config file (default is config.yaml)")
}

func main() {
    if err := rootCmd.Execute(); err != nil {
        fmt.Println(err)
        os.Exit(1)
    }
}


