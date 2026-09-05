export interface GolemInfo {
  name: string;
  emoji: string;
  status: "running" | "stopped" | "error" | "unknown";
  detail: string;
  description: string;
  trailerLines: string[];
}

export interface ServiceStatus {
  name: string;
  running: boolean;
  exitCode?: number;
}
