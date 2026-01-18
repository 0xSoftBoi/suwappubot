import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { ApiTester, useEndpointSelection } from './components/ApiTester';
import { RequestMonitor, useRequestSelection } from './components/RequestMonitor';
import { DatabaseViewer, useDatabaseViewer } from './components/DatabaseViewer';
import { LocalLogPanel, useLocalLogPanel, getNextFilter } from './components/LocalLogPanel';
import { StatusBar } from './components/StatusBar';
import {
  startApiServer,
  stopApiServer,
  isServerRunning,
  addLog,
} from './services/local';
import { testPredefinedEndpoint, ENDPOINTS, type EndpointKey } from './services/api';
import { clearRequestLogs } from './services/api';

type Panel = 'api' | 'requests' | 'database' | 'logs';

export function DebugApp() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Terminal dimensions
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  // UI State
  const [activePanel, setActivePanel] = useState<Panel>('api');
  const [message, setMessage] = useState('');
  const [serverRunning, setServerRunning] = useState(false);

  // Panel state hooks
  const endpointState = useEndpointSelection();
  const requestState = useRequestSelection();
  const databaseState = useDatabaseViewer();
  const logState = useLocalLogPanel();

  // Project root for starting server
  const projectRoot = process.cwd().replace('/tui', '');

  // Check server status periodically
  useEffect(() => {
    const check = () => setServerRunning(isServerRunning());
    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, []);

  const showMessage = useCallback((msg: string, duration = 3000) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), duration);
  }, []);

  // Handle test endpoint
  const handleTestEndpoint = useCallback(async () => {
    const keys = Object.keys(ENDPOINTS) as EndpointKey[];
    const key = keys[endpointState.selectedEndpoint];
    if (key) {
      showMessage(`Testing ${key}...`);
      await testPredefinedEndpoint(key);
      showMessage(`${key} tested`);
    }
  }, [endpointState.selectedEndpoint, showMessage]);

  // Handle test all endpoints
  const handleTestAll = useCallback(async () => {
    showMessage('Testing all endpoints...');
    const keys = Object.keys(ENDPOINTS) as EndpointKey[];
    for (const key of keys) {
      await testPredefinedEndpoint(key);
    }
    showMessage('All endpoints tested');
  }, [showMessage]);

  // Handle start/stop server
  const handleToggleServer = useCallback(async () => {
    if (serverRunning) {
      stopApiServer();
      showMessage('Server stopped');
    } else {
      showMessage('Starting server...');
      const success = await startApiServer(projectRoot);
      showMessage(success ? 'Server starting...' : 'Failed to start server');
    }
  }, [serverRunning, projectRoot, showMessage]);

  // Keyboard input
  useInput((input, key) => {
    // Global shortcuts
    if (input === 'q' || input === 'Q') {
      stopApiServer();
      exit();
      return;
    }

    // Panel switching with Tab or numbers
    if (key.tab) {
      const panels: Panel[] = ['api', 'requests', 'database', 'logs'];
      const idx = panels.indexOf(activePanel);
      setActivePanel(panels[(idx + 1) % panels.length]!);
      return;
    }

    // Quick panel switch
    if (key.meta || key.ctrl) {
      if (input === '1') {
        setActivePanel('api');
        return;
      }
      if (input === '2') {
        setActivePanel('requests');
        return;
      }
      if (input === '3') {
        setActivePanel('database');
        return;
      }
      if (input === '4') {
        setActivePanel('logs');
        return;
      }
    }

    // Server control
    if (input === 'x' || input === 'X') {
      handleToggleServer();
      return;
    }

    // Panel-specific inputs
    if (activePanel === 'api') {
      if (key.upArrow || input === 'k') {
        endpointState.moveUp();
        return;
      }
      if (key.downArrow || input === 'j') {
        endpointState.moveDown();
        return;
      }
      if (key.return) {
        handleTestEndpoint();
        return;
      }
      if (input === 'a' || input === 'A') {
        handleTestAll();
        return;
      }
    }

    if (activePanel === 'requests') {
      if (requestState.showDetails) {
        if (key.escape || input === 'b' || input === 'B') {
          requestState.hideDetails();
          return;
        }
      } else {
        if (key.upArrow || input === 'k') {
          requestState.moveUp();
          return;
        }
        if (key.downArrow || input === 'j') {
          requestState.moveDown(20);
          return;
        }
        if (key.return) {
          requestState.toggleDetails();
          return;
        }
        if (input === 'c' || input === 'C') {
          requestState.clear();
          showMessage('Requests cleared');
          return;
        }
      }
    }

    if (activePanel === 'database') {
      if (input === '1') {
        databaseState.setViewMode('swaps');
        return;
      }
      if (input === '2') {
        databaseState.setViewMode('wallets');
        return;
      }
      if (input === '3') {
        databaseState.setViewMode('stats');
        return;
      }
      if (key.upArrow || input === 'k') {
        databaseState.moveUp();
        return;
      }
      if (key.downArrow || input === 'j') {
        databaseState.moveDown(20);
        return;
      }
    }

    if (activePanel === 'logs') {
      if (input === 'p' || input === 'P') {
        logState.togglePause();
        showMessage(logState.isPaused ? 'Resumed' : 'Paused');
        return;
      }
      if (input === 'f' || input === 'F') {
        logState.cycleFilter();
        return;
      }
      if (key.upArrow || input === 'k') {
        logState.scrollUp();
        return;
      }
      if (key.downArrow || input === 'j') {
        logState.scrollDown();
        return;
      }
      if (input === 'g' || input === 'G') {
        logState.scrollToBottom();
        return;
      }
      if (input === 't' || input === 'T') {
        logState.scrollToTop();
        return;
      }
      if (input === 'c' || input === 'C') {
        logState.clear();
        showMessage('Logs cleared');
        return;
      }
    }

    // Refresh current view
    if (input === 'r' || input === 'R') {
      showMessage('Refreshing...');
      return;
    }
  });

  // Panel tabs
  const panels: { key: Panel; label: string }[] = [
    { key: 'api', label: 'API Tester' },
    { key: 'requests', label: 'Requests' },
    { key: 'database', label: 'Database' },
    { key: 'logs', label: 'Logs' },
  ];

  return (
    <Box flexDirection="column" height={terminalHeight}>
      {/* Header */}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        justifyContent="space-between"
      >
        <Box>
          <Text bold color="magenta">
            🔧 Suwappu Debug Console
          </Text>
        </Box>
        <Box>
          <Text dimColor>Server: </Text>
          {serverRunning ? (
            <Text color="green">● Running</Text>
          ) : (
            <Text color="red">○ Stopped</Text>
          )}
          <Text dimColor> | [X] Toggle</Text>
          <Text dimColor>
            {' '}
            | {terminalWidth}x{terminalHeight}
          </Text>
        </Box>
      </Box>

      {/* Tab bar */}
      <Box paddingX={1}>
        {panels.map((panel, idx) => (
          <Box key={panel.key} marginRight={2}>
            <Text
              color={activePanel === panel.key ? 'cyan' : 'gray'}
              bold={activePanel === panel.key}
            >
              [{idx + 1}] {panel.label}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Main content area - split view */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Left panel - main content */}
        <Box flexDirection="column" width="60%" flexGrow={1}>
          {activePanel === 'api' && (
            <ApiTester selectedEndpoint={endpointState.selectedEndpoint} />
          )}
          {activePanel === 'requests' && (
            <RequestMonitor
              selectedIndex={requestState.selectedIndex}
              showDetails={requestState.showDetails}
            />
          )}
          {activePanel === 'database' && (
            <DatabaseViewer
              viewMode={databaseState.viewMode}
              selectedIndex={databaseState.selectedIndex}
            />
          )}
          {activePanel === 'logs' && (
            <LocalLogPanel
              isPaused={logState.isPaused}
              filter={logState.filter}
              scrollOffset={logState.scrollOffset}
              maxLines={terminalHeight - 8}
            />
          )}
        </Box>

        {/* Right panel - always show logs (compact) */}
        {activePanel !== 'logs' && (
          <Box flexDirection="column" width="40%">
            <LocalLogPanel
              isPaused={logState.isPaused}
              filter={logState.filter}
              scrollOffset={logState.scrollOffset}
              maxLines={Math.floor((terminalHeight - 8) / 2)}
            />
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          [Tab] Switch panel | [Q] Quit | [X] Toggle server | [R] Refresh
        </Text>
        {message && (
          <Text color="yellow"> | {message}</Text>
        )}
      </Box>
    </Box>
  );
}
