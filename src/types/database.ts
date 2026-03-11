export interface ParticipantRow {
  id: string;
  full_name: string;
  tc_hash: string;
  created_at: string;
}

export interface TestSessionRow {
  id: string;
  participant_id: string;
  status: "in_progress" | "calibration_failed" | "completed" | "abandoned";
  calibration_error_px: number | null;
  screen_width: number | null;
  screen_height: number | null;
  started_at: string;
  completed_at: string | null;
  image_count: number;
  user_agent: string | null;
  recording_url: string | null;
}

export interface TestImageRow {
  id: string;
  image_url: string;
  storage_path: string;
  display_order: number;
  original_filename: string | null;
  is_active: boolean;
  uploaded_at: string;
}

export interface ImageResultRow {
  id: string;
  session_id: string;
  test_image_id: string | null;
  image_index: number;
  image_url: string;
  image_width: number;
  image_height: number;
  gaze_points: unknown[];
  fixations: unknown[];
  saccades: unknown[];
  metrics: Record<string, unknown> | null;
  heatmap_data_url: string | null;
  created_at: string;
}

export interface TestSessionWithParticipant extends TestSessionRow {
  participants: Pick<ParticipantRow, "id" | "full_name">;
}
