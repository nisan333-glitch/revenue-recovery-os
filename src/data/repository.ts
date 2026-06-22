// Repository abstraction. The UI depends only on this interface, so the
// localStorage backend can later be swapped for a REST/GraphQL API or an
// event-sourced server with zero UI changes.
import type { RecoveryEvent } from "../domain/types";

export interface RecoveryRepository {
  list(): RecoveryEvent[];
  get(eventId: string): RecoveryEvent | undefined;
  save(event: RecoveryEvent): void;
  saveAll(events: RecoveryEvent[]): void;
  reset(): void;
}
