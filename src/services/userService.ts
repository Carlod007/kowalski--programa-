// src/services/userService.ts
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { User as UserProfile } from '@/types/user'

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const ref = doc(db, 'users', userId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return snap.data() as UserProfile
}

export async function createUserProfile(
  userId: string,
  data: Pick<UserProfile, 'name' | 'email'>
): Promise<void> {
  const ref = doc(db, 'users', userId)
  const profile: UserProfile = {
    name: data.name,
    email: data.email,
    sources: [
      { id: '1', name: 'Planilla' },
      { id: '2', name: 'Tomodachi' },
      { id: '3', name: 'Lesion Out' },
      { id: '4', name: 'Luis Santana' },
    ],
    distribution: { necesidad: 70, ocio: 10, ahorro: 20 },
    subcategories: {
      necesidad: ['Agua', 'Luz', 'Gas', 'Internet', 'Clínica'],
      ocio: ['Transporte', 'Comida', 'Entretenimiento'],
      ahorro: ['BCP', 'Inversión BE', 'Inversión BP', 'Comodities'],
    },
    paymentMethods: [
      { id: '1', name: 'BCP', type: 'digital' },
      { id: '2', name: 'Scotiabank', type: 'digital' },
      { id: '3', name: 'BBVA', type: 'digital' },
      { id: '4', name: 'Interbank', type: 'digital' },
      { id: '5', name: 'Efectivo', type: 'cash' },
    ],
    closingNotification: { day: 1, time: '18:00' },
    onboardingCompleted: false,
    lastClosedMonth: null,
  }
  await setDoc(ref, profile)
}