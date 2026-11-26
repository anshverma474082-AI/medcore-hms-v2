import { create } from 'zustand';
export type User = { id: number; name: string; email: string; role: string; hospitalId: number | null; doctorId?: number; patientId?: number; patientPhone?: string; phoneVerified?: boolean };
type State = { user: User | null; setUser: (user: User | null) => void };
export const useSessionStore = create<State>((set) => ({ user: null, setUser: (user) => set({ user }) }));
