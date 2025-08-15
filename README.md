## Load data via curl

Post a YAML inventory to the running server (requires `BOARDGAMES_TOKEN` env):

```
curl -X POST -H "Authorization: Bearer $BOARDGAMES_TOKEN" --data-binary @data/inventory.yaml http://localhost:8080/api/load
```


