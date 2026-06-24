/** Server-side timestamps for a timed phase. Mirrors Go's GameTimers. */
export type GameTimers = {
  /** Phase start time in Unix milliseconds. */
  start_time: number
  /** When the actual phase begins (start_time + SYNC_DELAY). Show "get ready" overlay until this timestamp. */
  ready_time: number
  /** Phase end time in Unix milliseconds. */
  end_time: number
}
