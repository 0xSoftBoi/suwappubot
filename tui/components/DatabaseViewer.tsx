import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import {
  fetchSwaps,
  fetchWallets,
  findLocalDatabase,
  getLocalDatabaseStats,
  getRecentSwapsFromSqlite,
  getWalletsFromSqlite,
  type SwapRecord,
  type WalletRecord,
  type DatabaseStats,
} from '../services/database';

type ViewMode = 'swaps' | 'wallets' | 'stats';

interface DatabaseViewerProps {
  viewMode: ViewMode;
  selectedIndex: number;
}

export function DatabaseViewer({ viewMode, selectedIndex }: DatabaseViewerProps) {
  const [swaps, setSwaps] = useState<SwapRecord[]>([]);
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useApi, setUseApi] = useState(true);

  // Find local database on mount
  useEffect(() => {
    const findDb = async () => {
      const path = await findLocalDatabase();
      setDbPath(path);
    };
    findDb();
  }, []);

  // Fetch data based on mode
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (viewMode === 'swaps') {
        if (useApi) {
          const data = await fetchSwaps(20);
          setSwaps(data);
        } else if (dbPath) {
          const data = await getRecentSwapsFromSqlite(dbPath, 20);
          setSwaps(data);
        }
      } else if (viewMode === 'wallets') {
        if (useApi) {
          const data = await fetchWallets(1);
          setWallets(data);
        } else if (dbPath) {
          const data = await getWalletsFromSqlite(dbPath, 50);
          setWallets(data);
        }
      } else if (viewMode === 'stats') {
        if (dbPath) {
          const data = await getLocalDatabaseStats(dbPath);
          setStats(data);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [viewMode, useApi, dbPath]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'success':
        return 'green';
      case 'pending':
        return 'yellow';
      case 'failed':
      case 'error':
        return 'red';
      default:
        return 'gray';
    }
  };

  const truncateAddress = (addr: string): string => {
    if (!addr || addr.length < 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold>DATABASE</Text>
          <Text dimColor> ({viewMode.toUpperCase()})</Text>
          {isLoading && (
            <Text color="yellow">
              {' '}
              <Spinner type="dots" />
            </Text>
          )}
        </Box>
        <Box>
          <Text dimColor>Source: </Text>
          <Text color={useApi ? 'cyan' : 'yellow'}>{useApi ? 'API' : 'SQLite'}</Text>
          {dbPath && <Text dimColor> | {dbPath}</Text>}
        </Box>
      </Box>

      {/* Content */}
      <Box flexDirection="column" paddingX={1} marginTop={1} flexGrow={1}>
        {error ? (
          <Text color="red">Error: {error}</Text>
        ) : viewMode === 'swaps' ? (
          <SwapsTable swaps={swaps} selectedIndex={selectedIndex} />
        ) : viewMode === 'wallets' ? (
          <WalletsTable wallets={wallets} selectedIndex={selectedIndex} />
        ) : viewMode === 'stats' ? (
          <StatsView stats={stats} />
        ) : null}
      </Box>

      {/* Footer */}
      <Box paddingX={1}>
        <Text dimColor>
          [1] Swaps [2] Wallets [3] Stats | [S] Toggle API/SQLite | [R] Refresh
        </Text>
      </Box>
    </Box>
  );
}

function SwapsTable({
  swaps,
  selectedIndex,
}: {
  swaps: SwapRecord[];
  selectedIndex: number;
}) {
  if (swaps.length === 0) {
    return <Text dimColor>No swaps found</Text>;
  }

  return (
    <Box flexDirection="column">
      {/* Header row */}
      <Box>
        <Text dimColor>{'  '}</Text>
        <Text dimColor>{'ID'.padEnd(6)}</Text>
        <Text dimColor>{'From'.padEnd(12)}</Text>
        <Text dimColor>{'To'.padEnd(12)}</Text>
        <Text dimColor>{'Amount'.padEnd(12)}</Text>
        <Text dimColor>{'Status'.padEnd(10)}</Text>
        <Text dimColor>{'Time'}</Text>
      </Box>

      {/* Data rows */}
      {swaps.slice(0, 12).map((swap, idx) => {
        const isSelected = idx === selectedIndex;
        const statusColor =
          swap.status === 'completed'
            ? 'green'
            : swap.status === 'pending'
              ? 'yellow'
              : 'red';

        return (
          <Box key={swap.id}>
            <Text color={isSelected ? 'cyan' : 'white'}>
              {isSelected ? '▶ ' : '  '}
            </Text>
            <Text color={isSelected ? 'cyan' : 'gray'}>
              {swap.id.toString().padEnd(6)}
            </Text>
            <Text color={isSelected ? 'cyan' : 'white'}>
              {`${swap.fromChain}/${swap.fromToken}`.slice(0, 11).padEnd(12)}
            </Text>
            <Text color={isSelected ? 'cyan' : 'white'}>
              {`${swap.toChain}/${swap.toToken}`.slice(0, 11).padEnd(12)}
            </Text>
            <Text>{swap.fromAmount.slice(0, 11).padEnd(12)}</Text>
            <Text color={statusColor}>{swap.status.padEnd(10)}</Text>
            <Text dimColor>{swap.timestamp ? swap.timestamp.slice(0, 16) : '-'}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function WalletsTable({
  wallets,
  selectedIndex,
}: {
  wallets: WalletRecord[];
  selectedIndex: number;
}) {
  if (wallets.length === 0) {
    return <Text dimColor>No wallets found</Text>;
  }

  const truncateAddress = (addr: string): string => {
    if (!addr || addr.length < 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <Box flexDirection="column">
      {/* Header row */}
      <Box>
        <Text dimColor>{'  '}</Text>
        <Text dimColor>{'ID'.padEnd(5)}</Text>
        <Text dimColor>{'User'.padEnd(6)}</Text>
        <Text dimColor>{'Name'.padEnd(16)}</Text>
        <Text dimColor>{'Chain'.padEnd(8)}</Text>
        <Text dimColor>{'Address'.padEnd(15)}</Text>
        <Text dimColor>{'Status'}</Text>
      </Box>

      {/* Data rows */}
      {wallets.slice(0, 12).map((wallet, idx) => {
        const isSelected = idx === selectedIndex;

        return (
          <Box key={wallet.id}>
            <Text color={isSelected ? 'cyan' : 'white'}>
              {isSelected ? '▶ ' : '  '}
            </Text>
            <Text color={isSelected ? 'cyan' : 'gray'}>
              {wallet.id.toString().padEnd(5)}
            </Text>
            <Text>{wallet.userId.toString().padEnd(6)}</Text>
            <Text color={isSelected ? 'cyan' : 'white'}>
              {(wallet.name || 'Unnamed').slice(0, 15).padEnd(16)}
            </Text>
            <Text color="yellow">{wallet.chainType.padEnd(8)}</Text>
            <Text dimColor>{truncateAddress(wallet.address).padEnd(15)}</Text>
            <Text color={wallet.isActive ? 'green' : 'gray'}>
              {wallet.isActive ? 'Active' : 'Inactive'}
              {wallet.isDefault ? ' ★' : ''}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function StatsView({ stats }: { stats: DatabaseStats | null }) {
  if (!stats) {
    return <Text dimColor>No stats available (requires SQLite access)</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>Users: </Text>
        <Text bold color="cyan">
          {stats.userCount}
        </Text>
      </Box>
      <Box>
        <Text dimColor>Wallets: </Text>
        <Text bold color="cyan">
          {stats.walletCount}
        </Text>
      </Box>
      <Box>
        <Text dimColor>Swaps: </Text>
        <Text bold color="cyan">
          {stats.swapCount}
        </Text>
      </Box>
      <Box>
        <Text dimColor>Last Swap: </Text>
        <Text>{stats.lastSwapTime || 'Never'}</Text>
      </Box>
    </Box>
  );
}

// Hook for managing database viewer state
export function useDatabaseViewer() {
  const [viewMode, setViewMode] = useState<ViewMode>('swaps');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const setView = (mode: ViewMode) => {
    setViewMode(mode);
    setSelectedIndex(0);
  };

  const moveUp = () => setSelectedIndex((prev) => Math.max(0, prev - 1));
  const moveDown = (maxIndex: number) =>
    setSelectedIndex((prev) => Math.min(maxIndex, prev + 1));

  return {
    viewMode,
    setViewMode: setView,
    selectedIndex,
    setSelectedIndex,
    moveUp,
    moveDown,
  };
}
