# Debugging Guide for Suwappu Bot

This guide covers debugging setup for both local development and remote debugging on Render.

## Local Debugging

### VS Code / Cursor Debugging

1. **Install debugpy** (already in requirements.txt):
   ```bash
   pip install debugpy
   ```

2. **Use the debug configurations**:
   - Open the Debug panel (Cmd+Shift+D / Ctrl+Shift+D)
   - Select a configuration from the dropdown:
     - **Python: Bot Main** - Debug the Telegram bot
     - **Python: API Server** - Debug the FastAPI server
     - **Python: Current File** - Debug the currently open file
     - **Python: Pytest** - Debug tests
   - Press F5 to start debugging

### Command Line Debugging

Use the debug helper script:

```bash
# Debug the bot
python scripts/debug.py bot

# Debug the API server
python scripts/debug.py api

# Use custom port
python scripts/debug.py bot --port 5679

# Wait for debugger attachment
python scripts/debug.py bot --wait
```

Then attach from VS Code/Cursor using the "Python: Attach to Process" configuration.

## Remote Debugging (Render)

### Setup Remote Debugging on Render

1. **Add debugpy to your Render service**:
   - It's already in `requirements.txt`
   - Render will install it automatically

2. **Enable debugpy in your code**:
   Add this to the top of `bot/main.py` or `api/main.py`:
   ```python
   import os
   if os.getenv("ENABLE_DEBUGPY") == "true":
       import debugpy
       debugpy.listen(("0.0.0.0", 5678))
       print("🐛 Debugpy listening on port 5678")
   ```

3. **Set environment variable in Render**:
   - Go to your Render service dashboard
   - Add environment variable: `ENABLE_DEBUGPY=true`

4. **Create SSH tunnel**:
   ```bash
   # Get your Render service URL (e.g., suwappu.onrender.com)
   ssh -L 5678:localhost:5678 user@suwappu.onrender.com
   
   # Or use Render's SSH feature if available
   render ssh suwappu
   ```

5. **Attach debugger**:
   - Use the "Python: Remote Debug (Render)" configuration in VS Code/Cursor
   - Set breakpoints and debug!

### Alternative: Render Logs

For quick debugging without remote debugging:

```bash
# View logs in real-time
render logs suwappu --follow

# Filter for errors
render logs suwappu --follow | grep ERROR
```

## Render MCP Integration

### Setup Render MCP in Cursor

1. **Copy the MCP configuration**:
   ```bash
   cp mcp.json.example ~/.cursor/mcp.json
   ```

2. **Get your Render API Key**:
   - Go to [render.com/account/api-keys](https://dashboard.render.com/account/api-keys)
   - Create a new API key
   - Copy the key

3. **Set the API key**:
   ```bash
   export RENDER_API_KEY=your_api_key_here
   ```
   
   Or add it to your shell profile (`~/.zshrc` or `~/.bashrc`):
   ```bash
   echo 'export RENDER_API_KEY=your_api_key_here' >> ~/.zshrc
   source ~/.zshrc
   ```

4. **Restart Cursor**:
   - Close and reopen Cursor to load the MCP configuration

5. **Use MCP commands**:
   Once configured, you can ask the AI assistant in Cursor:
   - "Deploy suwappu to Render"
   - "Check deployment status"
   - "View logs for suwappu"
   - "Scale up the service"
   - "Restart the service"

### MCP Configuration Reference

The MCP configuration (`~/.cursor/mcp.json`) should look like:

```json
{
  "mcpServers": {
    "render": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-render"
      ],
      "env": {
        "RENDER_API_KEY": "${RENDER_API_KEY}"
      }
    }
  }
}
```

## Debugging Tips

### Common Issues

1. **Port already in use**:
   ```bash
   # Find process using port 5678
   lsof -i :5678
   # Kill it
   kill -9 <PID>
   ```

2. **Debugger not attaching**:
   - Check firewall settings
   - Verify port forwarding is correct
   - Ensure debugpy is listening on `0.0.0.0`, not `127.0.0.1`

3. **Breakpoints not hitting**:
   - Ensure `"justMyCode": false` in launch.json
   - Check path mappings for remote debugging
   - Verify you're debugging the correct process

### Performance Debugging

Enable detailed logging:

```bash
export LOG_LEVEL=DEBUG
python -m bot.main
```

Or in `.env`:
```
LOG_LEVEL=DEBUG
```

### Database Debugging

Enable SQL query logging:

```python
# In database/db.py, add:
import logging
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
```

## Troubleshooting

### MCP Not Working

1. Check that `RENDER_API_KEY` is set:
   ```bash
   echo $RENDER_API_KEY
   ```

2. Verify MCP server is installed:
   ```bash
   npx -y @modelcontextprotocol/server-render --help
   ```

3. Check Cursor logs:
   - Open Command Palette (Cmd+Shift+P)
   - Run "MCP: Show Logs"

### Debugging Not Starting

1. Verify debugpy is installed:
   ```bash
   python -c "import debugpy; print(debugpy.__version__)"
   ```

2. Check VS Code/Cursor Python extension is installed
3. Verify Python interpreter is selected correctly

## Additional Resources

- [debugpy Documentation](https://github.com/microsoft/debugpy)
- [Render MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/render)
- [VS Code Python Debugging](https://code.visualstudio.com/docs/python/debugging)
