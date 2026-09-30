import { Server } from 'http';
import { closePool } from '../store/postgres/postgresClient.ts';
import { logger } from '../utils/logger.ts';
import { sseBroker } from './sseBrokerService.ts';

class ShutdownService {
  private isShuttingDownFlag = false;

  public isShutdownRequested(): boolean {
    return this.isShuttingDownFlag;
  }

  /**
   * Reset shutdown state (for testing purposes).
   */
  public resetStateForTesting(): void {
    this.isShuttingDownFlag = false;
  }

  /**
   * Initiate graceful shutdown sequence upon SIGTERM / SIGINT or manual trigger.
   */
  public async initiateShutdown(
    signal: 'SIGTERM' | 'SIGINT' | 'TEST_SHUTDOWN',
    server?: Server,
    timeoutMs = 10000,
    isTestEnvironment = false
  ): Promise<void> {
    if (this.isShuttingDownFlag) {
      logger.info('Graceful shutdown is already in progress', {
        event: 'shutdown_in_progress',
        signal,
      });
      return;
    }

    this.isShuttingDownFlag = true;

    logger.info('Graceful shutdown sequence initiated', {
      event: 'shutdown_initiated',
      signal,
      timeoutMs,
    });

    // Bounded safety timeout timer
    const shutdownTimer = setTimeout(() => {
      logger.error('Graceful shutdown timeout exceeded. Forcing process exit', {
        event: 'shutdown_timeout_exceeded',
        timeoutMs,
      });
      if (!isTestEnvironment) {
        process.exit(1);
      }
    }, timeoutMs);

    // Prevent safety timer from keeping Node process alive if event loop clears
    if (shutdownTimer.unref) {
      shutdownTimer.unref();
    }

    try {
      // 1. Stop accepting new HTTP requests if HTTP server instance is active
      if (server) {
        await new Promise<void>((resolve) => {
          server.close((err) => {
            if (err) {
              logger.warn('Error closing HTTP server instance', {
                event: 'shutdown_http_close_error',
                error: err.message,
              });
            } else {
              logger.info('HTTP server stopped accepting new incoming requests', {
                event: 'shutdown_http_closed',
              });
            }
            resolve();
          });
        });
      }

      // 2. Clean up active SSE event streams and tickets
      sseBroker.closeAllConnections();

      // 3. Clean up PostgreSQL database pool connections
      await closePool();
      logger.info('PostgreSQL connection pool closed cleanly', {
        event: 'shutdown_postgres_closed',
      });

      logger.info('Graceful shutdown sequence completed successfully', {
        event: 'shutdown_completed',
      });

      clearTimeout(shutdownTimer);

      if (!isTestEnvironment && process.env.NODE_ENV !== 'test') {
        process.exit(0);
      }
    } catch (err: any) {
      logger.error('Error during graceful shutdown cleanup', {
        event: 'shutdown_cleanup_error',
        error: err.message || String(err),
      });
      clearTimeout(shutdownTimer);
      if (!isTestEnvironment && process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
    }
  }
}

export const shutdownService = new ShutdownService();
