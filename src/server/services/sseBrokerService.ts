import { GenerationProgressEvent } from '../../types/contentx.ts';

type EventListener = (event: GenerationProgressEvent) => void;

class SseBrokerService {
  private subscribers = new Map<string, Set<EventListener>>();
  private lastEvents = new Map<string, GenerationProgressEvent>();
  private eventSequenceMap = new Map<string, number>();

  /**
   * Subscribe a client listener to live generation progress events for a specific jobId.
   * Returns an unsubscribe function for convenient cleanup.
   */
  public subscribe(jobId: string, listener: EventListener): () => void {
    if (!this.subscribers.has(jobId)) {
      this.subscribers.set(jobId, new Set());
    }
    this.subscribers.get(jobId)!.add(listener);

    return () => {
      this.unsubscribe(jobId, listener);
    };
  }

  /**
   * Unsubscribe a client listener from a specific jobId.
   */
  public unsubscribe(jobId: string, listener: EventListener): void {
    const jobSubscribers = this.subscribers.get(jobId);
    if (jobSubscribers) {
      jobSubscribers.delete(listener);
      if (jobSubscribers.size === 0) {
        this.subscribers.delete(jobId);
      }
    }
  }

  /**
   * Publish a progress event to all active SSE subscribers for a jobId.
   * Non-blocking, isolated transient delivery. Safe if no subscribers exist.
   */
  public publish(jobId: string, eventPartial: Omit<GenerationProgressEvent, 'eventId' | 'timestamp'> & { eventId?: string; timestamp?: string }): GenerationProgressEvent {
    const nextSeq = (this.eventSequenceMap.get(jobId) || 0) + 1;
    this.eventSequenceMap.set(jobId, nextSeq);

    const fullEvent: GenerationProgressEvent = {
      ...eventPartial,
      eventId: eventPartial.eventId || `evt_${jobId}_${nextSeq}`,
      timestamp: eventPartial.timestamp || new Date().toISOString(),
    };

    // Store in memory for immediate state replay on new connection or reconnect
    this.lastEvents.set(jobId, fullEvent);

    const jobSubscribers = this.subscribers.get(jobId);
    if (jobSubscribers && jobSubscribers.size > 0) {
      for (const listener of Array.from(jobSubscribers)) {
        try {
          listener(fullEvent);
        } catch (err) {
          console.warn(`[SSE BROKER WARNING] Exception in listener for job ${jobId}:`, err);
        }
      }
    }

    return fullEvent;
  }

  /**
   * Get the last emitted progress event for a job (used for initial connection state).
   */
  public getLastEvent(jobId: string): GenerationProgressEvent | null {
    return this.lastEvents.get(jobId) || null;
  }

  /**
   * Clean up in-memory broker state for a job when terminal state is reached or after TTL.
   */
  public cleanup(jobId: string): void {
    this.subscribers.delete(jobId);
    this.lastEvents.delete(jobId);
    this.eventSequenceMap.delete(jobId);
  }

  /**
   * Get current active subscriber count for telemetry/debugging.
   */
  public getSubscriberCount(jobId: string): number {
    return this.subscribers.get(jobId)?.size || 0;
  }
}

export const sseBroker = new SseBrokerService();
