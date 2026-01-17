import { useState, useEffect } from 'react';
import type { DeploymentConfig } from '../types/deployment';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function useDeployments() {
  const [deployments, setDeployments] = useState<DeploymentConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDeployments = async () => {
      try {
        const deploymentsDir = join(import.meta.dir, '..', 'deployments');
        const files = await readdir(deploymentsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const configs: DeploymentConfig[] = [];
        for (const file of jsonFiles) {
          const content = await Bun.file(join(deploymentsDir, file)).json();
          configs.push(content as DeploymentConfig);
        }

        // Sort by environment: production first, then staging, then dev
        const order = { production: 0, staging: 1, development: 2 };
        configs.sort((a, b) =>
          (order[a.environment] ?? 99) - (order[b.environment] ?? 99)
        );

        setDeployments(configs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load deployments');
      } finally {
        setIsLoading(false);
      }
    };

    loadDeployments();
  }, []);

  return { deployments, isLoading, error };
}
