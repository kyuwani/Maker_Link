import type { NewSubmission, Room, Submission } from "../types";

/**
 * 수업방/제출물 저장소 인터페이스.
 * 지금은 IndexedDB + BroadcastChannel 구현(local-classroom-service.ts)을 쓰고,
 * 나중에 Supabase(테이블 + Storage + Realtime)로 같은 인터페이스를 구현해 교체하면 됩니다.
 */
export interface ClassroomService {
  /** 학교/학급 정보로 새 수업방을 만들고 겹치지 않는 4자리 코드를 발급합니다. */
  createRoom(input: { school: string; className: string }): Promise<Room>;
  getRoom(code: string): Promise<Room | null>;
  listRooms(): Promise<Room[]>;

  addSubmission(input: NewSubmission): Promise<Submission>;
  getSubmission(id: string): Promise<Submission | null>;
  listSubmissions(roomCode: string): Promise<Submission[]>;
  deleteSubmission(id: string): Promise<void>;

  /**
   * 해당 수업방의 제출물이 바뀔 때마다 최신 목록으로 콜백합니다.
   * 반환값을 호출하면 구독이 해제됩니다.
   */
  subscribeSubmissions(roomCode: string, cb: (items: Submission[]) => void): () => void;

  /**
   * 학생 입장 시 수업방 존재를 반드시 확인할지 여부.
   * 로컬 저장소는 기기(브라우저)마다 따로라서, 학생 폰에서는 교사가 만든 방을 볼 수 없으므로 false.
   * 서버 DB 구현에서는 true로 두세요.
   */
  readonly strictRoomCheck: boolean;
}
