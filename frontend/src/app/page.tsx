'use client';

import { useEffect, useMemo, useState } from 'react';
import Script from 'next/script';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowRight, Bell, CalendarDays, Check, ClipboardList, FileText, FlaskConical, LogOut, Plus, Search, ShieldCheck, Stethoscope, Wallet } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, apiFormData, data } from '@/lib/api';
import { useSessionStore, type User } from '@/lib/session';

type Envelope<T> = { success: boolean; data: T; message?: string };
type PagedResult<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };
type Appointment = { id: number; startsAt: string; status: string; reason: string; emergency?: boolean; patientName?: string; doctorName?: string; doctorId: number };
type Invoice = { id: number; amount: number; amountMinor: number; currency: string; status: string; items: Array<{ description: string; quantity: number; totalMinor: number }> };
type Doctor = { id: number; specialisation: string; user: { name: string }; department?: { name: string } };
type MedicalRecord = { id: number; createdAt: string; diagnosis: string; treatmentPlan?: string; bmi?: string; signed?: boolean; signedAt?: string | null; attachments?: Array<{ id: number; name: string; sizeBytes: number }> };
type PatientProfile = { birthDate: string; sex: string; bloodGroup: string; emergencyContactName: string; emergencyContactPhone: string; address: string };
type PrescriptionItem = { id: number; medicineName: string; dosage: string };
type Prescription = { id: number; patientId: number; dispensed?: boolean; signed?: boolean; items: PrescriptionItem[] };
type LabOrder = { id: number; testName: string; result?: string; status: string };
type Medicine = { id: number; name: string; sku: string; category: string; unit: string; available: number; expiredQuantity: number; lowStock: boolean; reorderLevel: number };
type NotificationItem = { id: number; title: string; body: string; readAt?: string | null; createdAt: string };
type RazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => Promise<void>;
};
type RazorpayConstructor = new (options: RazorpayOptions) => { open: () => void };
declare global { interface Window { Razorpay?: RazorpayConstructor } }
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
type LoginForm = z.infer<typeof loginSchema>;
const tabs = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays },
  { id: 'clinical', label: 'Clinical care', icon: ClipboardList },
  { id: 'laboratory', label: 'Laboratory', icon: FlaskConical },
  { id: 'billing', label: 'Billing', icon: Wallet },
  { id: 'notifications', label: 'Notifications', icon: Bell },
];

export default function Home() {
  const queryClient = useQueryClient();
  const { user, setUser } = useSessionStore();
  const [activeTab, setActiveTab] = useState('overview');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [registering, setRegistering] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [confirmingPasswordReset, setConfirmingPasswordReset] = useState(false);
  const [phoneCodeRequested, setPhoneCodeRequested] = useState(false);
  const [pendingPhone, setPendingPhone] = useState('');
  const [localPhoneCode, setLocalPhoneCode] = useState('');
  const [appointmentQuery, setAppointmentQuery] = useState('');
  const [appointmentStatus, setAppointmentStatus] = useState('all');
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [globalQuery, setGlobalQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const loginForm = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  useEffect(() => { api('/auth/csrf').then(() => api<Envelope<User>>('/auth/me')).then((r) => setUser(data(r))).catch(() => undefined); }, [setUser]);

  const appointmentsQuery = useQuery({ queryKey: ['appointments'], queryFn: async () => data(await api<Envelope<Appointment[]>>('/appointments')), enabled: !!user });
  const appointmentPageQuery = useQuery({
    queryKey: ['appointments-page', appointmentPage, appointmentQuery, appointmentStatus],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(appointmentPage), pageSize: '10' });
      if (appointmentQuery.trim()) params.set('q', appointmentQuery.trim().slice(0, 100));
      if (appointmentStatus !== 'all') params.set('status', appointmentStatus);
      return data(await api<Envelope<PagedResult<Appointment>>>('/appointments/page?' + params.toString()));
    },
    enabled: !!user,
  });
  const doctorsQuery = useQuery({ queryKey: ['doctors'], queryFn: async () => data(await api<Envelope<Doctor[]>>('/doctors')), enabled: !!user && ['patient', 'hospital_admin', 'receptionist'].includes(user.role) });
  const recordsQuery = useQuery({ queryKey: ['records'], queryFn: async () => data(await api<Envelope<MedicalRecord[]>>('/records')), enabled: !!user && ['patient', 'doctor', 'hospital_admin', 'nurse'].includes(user.role) });
  const prescriptionsQuery = useQuery({ queryKey: ['prescriptions'], queryFn: async () => data(await api<Envelope<Prescription[]>>('/prescriptions')), enabled: !!user && ['patient', 'doctor', 'hospital_admin', 'pharmacist'].includes(user.role) });
  const invoicesQuery = useQuery({ queryKey: ['invoices'], queryFn: async () => data(await api<Envelope<Invoice[]>>('/billing/invoices')), enabled: !!user && ['patient', 'hospital_admin', 'accountant', 'receptionist', 'super_admin'].includes(user.role) });
  const labsQuery = useQuery({ queryKey: ['labs'], queryFn: async () => data(await api<Envelope<LabOrder[]>>('/lab-orders')), enabled: !!user && ['patient', 'doctor', 'hospital_admin', 'lab_technician'].includes(user.role) });
  const medicinesQuery = useQuery({ queryKey: ['medicines'], queryFn: async () => data(await api<Envelope<Medicine[]>>('/medicines')), enabled: !!user && ['doctor', 'hospital_admin', 'pharmacist'].includes(user.role) });
  const notificationsQuery = useQuery({ queryKey: ['notifications'], queryFn: async () => data(await api<Envelope<NotificationItem[]>>('/notifications/me')), enabled: !!user });
  const patientProfileQuery = useQuery({ queryKey: ['patient-profile'], queryFn: async () => data(await api<Envelope<PatientProfile>>('/patients/me/profile')), enabled: !!user && user.role === 'patient' });
  const appointments = useMemo(() => appointmentsQuery.data ?? [], [appointmentsQuery.data]);
  const appointmentPageSize = 10;
  const filteredAppointmentCount = appointmentPageQuery.data?.total ?? 0;
  const appointmentPageCount = appointmentPageQuery.data?.totalPages ?? 1;
  const visibleAppointments = appointmentPageQuery.data?.items ?? [];
  useEffect(() => { if (appointmentPage > appointmentPageCount) setAppointmentPage(appointmentPageCount); }, [appointmentPage, appointmentPageCount]);
  const invoices = useMemo(() => invoicesQuery.data ?? [], [invoicesQuery.data]);
  const chartData = useMemo(() => {
    const counts = new Map<string, number>();
    appointments.forEach((item) => { const day = new Date(item.startsAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); counts.set(day, (counts.get(day) || 0) + 1); });
    return Array.from(counts, ([day, visits]) => ({ day, visits })).slice(-7);
  }, [appointments]);
  const globalSearchMatches = useMemo(() => {
    const query = globalQuery.trim().toLowerCase();
    if (!query) return [] as Array<{ title: string; detail: string; tab: string }>;
    const matches: Array<{ title: string; detail: string; tab: string }> = [];
    const add = (title: string, detail: string, tab: string) => { if ((title + ' ' + detail).toLowerCase().includes(query)) matches.push({ title, detail, tab }); };
    appointments.forEach((a) => add('Appointment #' + a.id, [a.reason, a.patientName, a.doctorName, a.status].filter(Boolean).join(' · '), 'appointments'));
    (recordsQuery.data || []).forEach((r) => add('Visit record #' + r.id, r.diagnosis + ' · ' + (r.treatmentPlan || ''), 'clinical'));
    (prescriptionsQuery.data || []).forEach((rx) => add('Prescription #' + rx.id, rx.items.map((item) => item.medicineName).join(', '), 'clinical'));
    (labsQuery.data || []).forEach((lab) => add('Lab order: ' + lab.testName, lab.status + ' · ' + (lab.result || ''), 'laboratory'));
    invoices.forEach((invoice) => add('Invoice #' + invoice.id, invoice.status + ' · ' + invoice.currency + ' ' + invoice.amount, 'billing'));
    (medicinesQuery.data || []).forEach((medicine) => add(medicine.name, medicine.sku + ' · ' + medicine.category, 'pharmacy'));
    (notificationsQuery.data || []).forEach((notification) => add(notification.title, notification.body, 'notifications'));
    return matches.slice(0, 10);
  }, [globalQuery, appointments, recordsQuery.data, prescriptionsQuery.data, labsQuery.data, invoices, medicinesQuery.data, notificationsQuery.data]);

  async function signIn(values: LoginForm) {
    setBusy(true); setError('');
    try { const result = await api<Envelope<{ user: User }>>('/auth/login', { method: 'POST', body: JSON.stringify(values) }); setUser(result.data.user); setMessage('Welcome back. Your workspace is ready.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sign in failed'); }
    finally { setBusy(false); }
  }
  async function signUp(form: FormData) {
    setBusy(true); setError(''); setMessage('');
    try {
      const account = Object.fromEntries(form.entries());
      await api('/auth/register', { method: 'POST', body: JSON.stringify(account) });
      const otp = data(await api<Envelope<{ code: string }>>('/auth/dev-otp?email=' + encodeURIComponent(String(account.email))));
      await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email: account.email, otp: otp.code }) });
      setRegistering(false); setMessage('Account verified. Sign in to continue.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Registration failed'); }
    finally { setBusy(false); }
  }
  async function requestPasswordReset(form: FormData) {
    const email = String(form.get('email') || '');
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) });
      let localCode = '';
      try { const result = data(await api<Envelope<{ code: string }>>('/auth/dev-password-reset-code?email=' + encodeURIComponent(email))); localCode = result.code; } catch { /* Email delivery handles hosted environments. */ }
      setConfirmingPasswordReset(true);
      setMessage(localCode ? 'Local demo reset code: ' + localCode : 'If the account exists, a password reset code has been sent.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not request a reset code'); }
    finally { setBusy(false); }
  }
  async function confirmPasswordReset(form: FormData) {
    const values = Object.fromEntries(form.entries());
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ email: values.email, otp: values.otp, password: values.password }) });
      setResettingPassword(false); setConfirmingPasswordReset(false); setMessage('Password updated. Sign in with your new password.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reset the password'); }
    finally { setBusy(false); }
  }
  async function requestPhoneVerification(form: FormData) {
    const phone = String(form.get('phone') || '').trim();
    setBusy(true); setError(''); setMessage('');
    try {
      const result = data(await api<Envelope<{ phoneVerified: boolean; sent?: boolean; cooldown?: boolean }>>('/auth/phone-verification/request', { method: 'POST', body: JSON.stringify({ phone }) }));
      if (result.phoneVerified) { setUser({ ...user!, patientPhone: phone, phoneVerified: true }); setMessage('This phone number is already verified.'); }
      else if (result.sent) {
        setPendingPhone(phone);
        setPhoneCodeRequested(true);
        setUser({ ...user!, patientPhone: phone, phoneVerified: false });
        let localCode = '';
        try { const dev = data(await api<Envelope<{ code: string }>>('/auth/dev-phone-otp')); localCode = dev.code; setLocalPhoneCode(dev.code); }
        catch { setLocalPhoneCode(''); }
        setMessage('A verification code was sent to your phone.' + (localCode ? ' Local demo code: ' + localCode : ''));
      } else {
        setMessage('A code was recently sent. Check your phone and try again shortly.');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send a phone verification code'); }
    finally { setBusy(false); }
  }
  async function confirmPhoneVerification(form: FormData) {
    const values = Object.fromEntries(form.entries());
    setBusy(true); setError(''); setMessage('');
    try {
      const result = data(await api<Envelope<{ phoneVerified: boolean; phone: string }>>('/auth/phone-verification/confirm', { method: 'POST', body: JSON.stringify({ phone: values.phone, otp: values.otp }) }));
      setUser({ ...user!, patientPhone: result.phone, phoneVerified: true });
      setPhoneCodeRequested(false); setLocalPhoneCode(''); setMessage('Phone number verified.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not verify the phone number'); }
    finally { setBusy(false); }
  }
  async function signOut() { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); setUser(null); queryClient.clear(); }
  async function bookAppointment(form: FormData) {
    setBusy(true); setError(''); setMessage('');
    try {
      const startsAt = new Date(String(form.get('startsAt'))).toISOString();
      await api('/appointments', { method: 'POST', body: JSON.stringify({ doctorId: Number(form.get('doctorId')), startsAt, reason: String(form.get('reason') || ''), emergency: form.get('emergency') === 'on' }) });
      await queryClient.invalidateQueries({ queryKey: ['appointments'] }); setMessage('Appointment requested.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not book appointment'); }
    finally { setBusy(false); }
  }
  async function changeStatus(id: number, status: string) {
    setError('');
    try { await api('/appointments/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status }) }); await queryClient.invalidateQueries({ queryKey: ['appointments'] }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update appointment'); }
  }
  async function cancelAppointment(id: number) {
    setError('');
    try { await api('/appointments/' + id + '/cancel', { method: 'PATCH' }); await queryClient.invalidateQueries({ queryKey: ['appointments'] }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel appointment'); }
  }
  async function createRecord(appointmentId: number, form: FormData) {
    setBusy(true); setError(''); setMessage('');
    try {
      const attachment = form.get('attachment'); form.delete('attachment');
      const created = data(await api<Envelope<MedicalRecord>>('/appointments/' + appointmentId + '/records', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) }));
      if (attachment instanceof File && attachment.size > 0) { const upload = new FormData(); upload.set('file', attachment); await apiFormData('/records/' + created.id + '/attachments', 'POST', upload); }
      await queryClient.invalidateQueries({ queryKey: ['records'] }); setMessage('Encrypted, electronically signed medical record saved.');
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the record'); }
    finally { setBusy(false); }
  }
  async function updatePatientProfile(form: FormData) {
    setBusy(true); setError(''); setMessage('');
    try { const values: Record<string, FormDataEntryValue | null> = Object.fromEntries(form.entries()); if (values.birthDate === '') values.birthDate = null; await api('/patients/me/profile', { method: 'PATCH', body: JSON.stringify(values) }); await queryClient.invalidateQueries({ queryKey: ['patient-profile'] }); setMessage('Patient profile updated. Emergency contact and address are encrypted at rest.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update profile'); }
    finally { setBusy(false); }
  }
  async function createPrescription(appointmentId: number, form: FormData) {
    setBusy(true); setError(''); setMessage('');
    try { const values = Object.fromEntries(form.entries()); const items = [1, 2, 3].map((i) => ({ medicineName: String(values['medicineName' + i] || '').trim(), dosage: String(values['dosage' + i] || '').trim(), frequency: String(values['frequency' + i] || '').trim(), duration: String(values['duration' + i] || '').trim(), instructions: String(values['itemInstructions' + i] || '').trim() })).filter((item) => item.medicineName); if (!items.length) throw new Error('Add at least one medicine to the prescription'); await api('/appointments/' + appointmentId + '/prescriptions', { method: 'POST', body: JSON.stringify({ instructions: values.instructions, items }) }); await queryClient.invalidateQueries({ queryKey: ['prescriptions'] }); setMessage('Prescription saved. A signed PDF is ready to download.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the prescription'); }
    finally { setBusy(false); }
  }
  async function createLabOrder(appointmentId: number, form: FormData) {
    setBusy(true); setError('');
    try { await api('/appointments/' + appointmentId + '/lab-orders', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) }); await queryClient.invalidateQueries({ queryKey: ['labs'] }); setMessage('Laboratory test ordered.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not order the test'); }
    finally { setBusy(false); }
  }
  async function uploadLabResult(id: number, form: FormData) {
    setBusy(true); setError('');
    try { await api('/lab-orders/' + id + '/result', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(form.entries())) }); await queryClient.invalidateQueries({ queryKey: ['labs'] }); setMessage('Result uploaded for clinician review.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not upload result'); }
    finally { setBusy(false); }
  }
  async function approveLab(id: number) {
    try { await api('/lab-orders/' + id + '/approve', { method: 'PATCH' }); await queryClient.invalidateQueries({ queryKey: ['labs'] }); setMessage('Lab result approved.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not approve result'); }
  }
  async function createInvoice(appointmentId: number, form: FormData) {
    setBusy(true); setError('');
    try { const values = Object.fromEntries(form.entries()); const items = [1, 2, 3].map((i) => ({ description: String(values['description' + i] || '').trim(), quantity: Number(values['quantity' + i] || 1), unitAmountMinor: Math.round(Number(values['amount' + i] || 0) * 100) })).filter((item) => item.description); if (!items.length) throw new Error('Add at least one invoice line with a description'); if (items.some((item) => !Number.isSafeInteger(item.unitAmountMinor) || item.unitAmountMinor <= 0)) throw new Error('Each charge needs a positive unit price'); await api('/appointments/' + appointmentId + '/invoice', { method: 'POST', body: JSON.stringify({ currency: 'INR', items }) }); await queryClient.invalidateQueries({ queryKey: ['invoices'] }); setMessage('Invoice created for the selected appointment.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create invoice'); }
    finally { setBusy(false); }
  }
  async function createMedicine(form: FormData) {
    setBusy(true); setError('');
    try { await api('/medicines', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) }); await queryClient.invalidateQueries({ queryKey: ['medicines'] }); setMessage('Medicine added to the catalogue.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add medicine'); }
    finally { setBusy(false); }
  }
  async function receiveBatch(medicineId: number, form: FormData) {
    setBusy(true); setError('');
    try { await api('/medicines/' + medicineId + '/batches', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) }); await queryClient.invalidateQueries({ queryKey: ['medicines'] }); setMessage('Inventory batch received.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not receive inventory'); }
    finally { setBusy(false); }
  }
  async function dispensePrescription(id: number, items: PrescriptionItem[], form: FormData) {
    setBusy(true); setError('');
    try { await api('/prescriptions/' + id + '/dispense', { method: 'POST', body: JSON.stringify({ items: items.map((item) => ({ prescriptionItemId: item.id, quantity: Number(form.get('quantity-' + item.id)) })) }) }); await queryClient.invalidateQueries({ queryKey: ['prescriptions'] }); await queryClient.invalidateQueries({ queryKey: ['medicines'] }); setMessage('Prescription dispensed using earliest-expiry stock.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not dispense prescription'); }
    finally { setBusy(false); }
  }
  async function payInvoice(invoice: Invoice) {
    setError('');
    try {
      const order = data(await api<Envelope<{ keyId: string; orderId: string; amount: number; currency: string; name: string }>>('/billing/invoices/' + invoice.id + '/payment-order', { method: 'POST' }));
      const RazorpayCheckout = window.Razorpay;
      if (!RazorpayCheckout) throw new Error('Payment checkout is still loading');
      const checkout = new RazorpayCheckout({ key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency, name: order.name,
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          await api('/billing/payments/verify', { method: 'POST', body: JSON.stringify({ orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }) });
          await queryClient.invalidateQueries({ queryKey: ['invoices'] }); setMessage('Payment confirmed.');
        },
      });
      checkout.open();
    } catch (e) { setError(e instanceof Error ? e.message : 'Payment could not start'); }
  }

  if (!user) return <main className="grid min-h-screen lg:grid-cols-[1.1fr_.9fr]">
    <section className="relative hidden overflow-hidden bg-[#102d39] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="absolute -right-20 -top-16 h-96 w-96 rounded-full bg-teal/30 blur-3xl" />
      <div className="relative flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-teal"><Activity /></div><span className="text-lg font-bold tracking-wide">MEDCORE <span className="font-normal text-teal-200">HMS</span></span></div>
      <div className="relative max-w-xl"><p className="mb-4 text-xs font-bold uppercase tracking-[.24em] text-teal-200">Care operations</p><h1 className="text-5xl font-semibold leading-tight">Better care begins with a clearer picture.</h1><p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">One secure workspace for appointments, clinical notes, pharmacy, laboratory and billing.</p><div className="mt-9 flex gap-3 text-sm text-slate-300"><span className="rounded-full border border-white/15 px-4 py-2">Role based</span><span className="rounded-full border border-white/15 px-4 py-2">Encrypted notes</span><span className="rounded-full border border-white/15 px-4 py-2">Multi hospital</span></div></div>
      <p className="relative text-xs text-slate-400">Academic project demo · Do not enter real patient data</p>
    </section>
    <section className="flex items-center justify-center px-5 py-12 sm:px-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-card sm:p-10">
        <div className="mb-8 flex items-center gap-3 lg:hidden"><div className="grid h-10 w-10 place-items-center rounded-xl bg-teal text-white"><Activity size={21} /></div><b>MEDCORE HMS</b></div>
        <p className="text-xs font-bold uppercase tracking-[.2em] text-teal">{registering ? 'Patient access' : resettingPassword ? 'Account recovery' : 'Welcome back'}</p>
        <h2 className="mt-3 text-3xl font-semibold">{registering ? 'Create an account' : resettingPassword ? confirmingPasswordReset ? 'Choose a new password' : 'Reset your password' : 'Sign in to MedCore'}</h2>
        <p className="mt-2 text-sm text-slate-500">{registering ? 'Ask your hospital for its registration code.' : resettingPassword ? 'We will send a one-time code if the account exists.' : 'Use a demo account or the account created for your hospital.'}</p>
        {resettingPassword ? confirmingPasswordReset ? <form action={confirmPasswordReset} className="mt-8 space-y-4">
          <Field label="Email address" name="email" type="email" required autoComplete="email" defaultValue={loginForm.getValues('email')} />
          <Field label="Six-digit reset code" name="otp" required minLength={6} maxLength={6} inputMode="numeric" />
          <Field label="New password" name="password" type="password" required minLength={12} autoComplete="new-password" />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Updating password…' : 'Update password'} <ArrowRight size={16} /></Button>
          <button type="button" className="w-full py-2 text-sm text-slate-500" onClick={() => setConfirmingPasswordReset(false)}>Request another code</button>
        </form> : <form action={requestPasswordReset} className="mt-8 space-y-4">
          <Field label="Email address" name="email" type="email" required autoComplete="email" defaultValue={loginForm.getValues('email')} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending code…' : 'Send reset code'} <ArrowRight size={16} /></Button>
          <button type="button" className="w-full py-2 text-sm text-slate-500" onClick={() => setResettingPassword(false)}>Back to sign in</button>
        </form> : registering ? <form action={signUp} className="mt-8 space-y-4">
          <Field label="Full name" name="name" required minLength={2} autoComplete="name" />
          <Field label="Email address" name="email" type="email" required autoComplete="email" />
          <Field label="Password" name="password" type="password" required minLength={12} autoComplete="new-password" />
          <Field label="Hospital code" name="hospitalCode" required />
          <Field label="Phone (optional)" name="phone" type="tel" />
          <Button type="submit" className="mt-2 w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'} <ArrowRight size={16} /></Button>
          <button type="button" className="w-full py-2 text-sm text-slate-500" onClick={() => setRegistering(false)}>Already have an account? Sign in</button>
        </form> : <form className="mt-8 space-y-5" onSubmit={loginForm.handleSubmit(signIn)}>
          <label className="block text-sm font-medium">Email address<input {...loginForm.register('email')} type="email" autoComplete="username" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/15" placeholder="you@hospital.com" /></label>
          {loginForm.formState.errors.email && <p className="text-xs text-rose-600">{loginForm.formState.errors.email.message}</p>}
          <label className="block text-sm font-medium">Password<input {...loginForm.register('password')} type="password" autoComplete="current-password" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/15" placeholder="Enter your password" /></label>
          {loginForm.formState.errors.password && <p className="text-xs text-rose-600">Password is required.</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} /></Button>
          <button type="button" className="w-full py-1 text-sm text-teal" onClick={() => { setResettingPassword(true); setError(''); setMessage(''); }}>Forgot password?</button>
          <div className="rounded-xl bg-mist p-4 text-xs leading-5 text-slate-600"><b className="text-ink">Demo admin</b><br />admin@city.example · DemoPass123!<br />Use the seeded account after running the database seed.</div>
          <button type="button" className="w-full py-2 text-sm text-slate-500" onClick={() => setRegistering(true)}>New patient? Create an account</button>
        </form>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
      </div>
    </section>
  </main>;

  const firstName = user.name.split(' ')[0];
  const pending = appointments.filter((a) => a.status === 'pending').length;
  const unpaid = invoices.filter((i) => ['unpaid', 'pending', 'failed'].includes(i.status)).reduce((sum, i) => sum + i.amount, 0);
  const labsAwaitingReview = (labsQuery.data || []).filter((r) => r.status === 'result_uploaded').length;
  const lowStock = (medicinesQuery.data || []).filter((m) => m.lowStock).length;
  const expiredStock = (medicinesQuery.data || []).filter((m) => m.expiredQuantity > 0).length;
  const dashboardMetrics = user.role === 'patient' ? [
    { icon: CalendarDays, label: 'My appointments', value: appointments.length, foot: pending + ' awaiting confirmation' },
    { icon: Wallet, label: 'Outstanding bills', value: '₹' + unpaid.toLocaleString('en-IN'), foot: invoices.filter((i) => i.status === 'paid').length + ' paid' },
    { icon: FlaskConical, label: 'Lab results', value: (labsQuery.data || []).filter((r) => r.status === 'approved').length, foot: labsAwaitingReview + ' awaiting clinician review' },
    { icon: ClipboardList, label: 'Visit records', value: recordsQuery.data?.length || 0, foot: (prescriptionsQuery.data?.length || 0) + ' prescriptions' },
  ] : user.role === 'doctor' ? [
    { icon: CalendarDays, label: 'My appointments', value: appointments.length, foot: pending + ' need attention' },
    { icon: ClipboardList, label: 'Clinical records', value: recordsQuery.data?.length || 0, foot: (prescriptionsQuery.data?.length || 0) + ' prescriptions signed' },
    { icon: FlaskConical, label: 'Lab reviews', value: labsAwaitingReview, foot: 'Awaiting approval' },
    { icon: Activity, label: 'Completed visits', value: appointments.filter((a) => a.status === 'completed').length, foot: 'In this workspace' },
  ] : user.role === 'pharmacist' ? [
    { icon: Stethoscope, label: 'Medicines', value: medicinesQuery.data?.length || 0, foot: lowStock + ' at reorder level' },
    { icon: ShieldCheck, label: 'Low stock alerts', value: lowStock, foot: expiredStock + ' with expired batches' },
    { icon: FileText, label: 'To dispense', value: (prescriptionsQuery.data || []).filter((rx) => !rx.dispensed).length, foot: 'Prescription queue' },
    { icon: CalendarDays, label: 'Visits today', value: appointments.length, foot: 'In this workspace' },
  ] : user.role === 'lab_technician' ? [
    { icon: FlaskConical, label: 'Orders to process', value: (labsQuery.data || []).filter((r) => r.status === 'ordered').length, foot: (labsQuery.data?.length || 0) + ' total orders' },
    { icon: Check, label: 'Awaiting approval', value: labsAwaitingReview, foot: 'Uploaded results' },
    { icon: CalendarDays, label: 'Appointments', value: appointments.length, foot: pending + ' need attention' },
    { icon: ShieldCheck, label: 'Approved results', value: (labsQuery.data || []).filter((r) => r.status === 'approved').length, foot: 'Ready for care team' },
  ] : [
    { icon: CalendarDays, label: 'Appointments', value: appointments.length, foot: pending + ' need attention' },
    { icon: Wallet, label: 'Unpaid bills', value: '₹' + unpaid.toLocaleString('en-IN'), foot: invoices.filter((i) => i.status === 'paid').length + ' paid' },
    { icon: FlaskConical, label: 'Lab reviews', value: labsAwaitingReview, foot: 'Awaiting approval' },
    { icon: ClipboardList, label: 'Clinical records', value: recordsQuery.data?.length || 0, foot: (prescriptionsQuery.data?.length || 0) + ' prescriptions' },
  ];
  const canBook = ['patient', 'hospital_admin', 'receptionist'].includes(user.role);
  const canUpdateAppointment = ['doctor', 'hospital_admin', 'receptionist'].includes(user.role);
  const nav = tabs.filter((item) => item.id !== 'clinical' || ['patient', 'doctor', 'hospital_admin', 'nurse', 'pharmacist'].includes(user.role)).filter((item) => item.id !== 'billing' || ['patient', 'hospital_admin', 'accountant', 'receptionist', 'super_admin'].includes(user.role));
  if (['hospital_admin', 'pharmacist'].includes(user.role)) nav.push({ id: 'pharmacy', label: 'Pharmacy', icon: Stethoscope });

  return <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
    <aside className="hidden min-h-screen border-r border-slate-200 bg-white p-5 lg:flex lg:flex-col">
      <div className="mb-10 flex items-center gap-3 px-2"><div className="grid h-10 w-10 place-items-center rounded-xl bg-teal text-white"><Activity size={20} /></div><div><b className="block text-sm">MEDCORE HMS</b><span className="text-[10px] uppercase tracking-wider text-slate-400">Care operations</span></div></div>
      <p className="px-3 pb-3 text-[10px] font-bold uppercase tracking-[.2em] text-slate-400">Workspace</p>
      <nav className="space-y-1">{nav.map((item) => <button key={item.id} onClick={() => setActiveTab(item.id)} className={'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ' + (activeTab === item.id ? 'bg-mist text-teal' : 'text-slate-500 hover:bg-slate-50')}><item.icon size={18} />{item.label}{item.id === 'appointments' && pending > 0 && <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs">{pending}</span>}</button>)}</nav>
      <div className="mt-auto rounded-2xl bg-[#102d39] p-4 text-white"><ShieldCheck size={20} className="text-teal-200" /><p className="mt-3 text-sm font-semibold">Privacy first</p><p className="mt-1 text-xs leading-5 text-slate-300">Clinical notes are encrypted before storage.</p></div>
    </aside>
    <main className="min-w-0">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur sm:px-8">
        <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-teal text-white lg:hidden"><Activity size={18} /></div><div><p className="text-xs text-slate-400">{user.hospitalId ? 'City Hospital' : 'Platform workspace'}</p><h1 className="font-semibold">{nav.find((item) => item.id === activeTab)?.label || 'Workspace'}</h1></div></div>
        <div className="relative mx-4 hidden max-w-md flex-1 md:block"><label className="relative block"><span className="sr-only">Search all available records</span><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input type="search" value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} placeholder="Search across your workspace" className="field w-full pl-9" /></label>{globalQuery.trim() && <div className="absolute left-0 right-0 top-12 z-20 max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">{globalSearchMatches.length ? globalSearchMatches.map((hit, index) => <button key={hit.tab + hit.title + index} onClick={() => { setActiveTab(hit.tab); setGlobalQuery(''); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-mist"><span className="block text-sm font-semibold">{hit.title}</span><span className="block truncate text-xs text-slate-500">{hit.detail}</span></button>) : <p className="p-3 text-sm text-slate-500">No matches in the records available to your account.</p>}</div>}</div>
        <div className="flex items-center gap-3"><div className="hidden text-right sm:block"><p className="text-sm font-semibold">{user.name}</p><p className="text-xs capitalize text-slate-400">{user.role.replaceAll('_', ' ')}</p></div><div className="grid h-10 w-10 place-items-center rounded-full bg-mist font-bold text-teal">{firstName[0]}</div><Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}><LogOut size={18} /></Button></div>
      </header>
      <div className="border-b border-slate-200 bg-white px-3 py-2 lg:hidden"><div className="flex gap-2 overflow-x-auto">{nav.map((item) => <button key={item.id} onClick={() => setActiveTab(item.id)} className={'whitespace-nowrap rounded-lg px-3 py-2 text-xs ' + (activeTab === item.id ? 'bg-teal text-white' : 'bg-slate-100 text-slate-600')}>{item.label}</button>)}</div></div>
      <div className="mx-auto max-w-7xl p-5 sm:p-8">
        {error && <p role="alert" className="mb-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {message && <p role="status" className="mb-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
        {activeTab === 'overview' && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-teal">Your care workspace</p><h2 className="mt-1 text-3xl font-semibold">Welcome, {firstName}</h2><p className="mt-2 text-sm text-slate-500">Here’s the latest activity across your hospital.</p></div>{canBook && <Button onClick={() => setActiveTab('appointments')}><Plus size={16} /> Book appointment</Button>}</div>
          {user.role === 'patient' && <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-semibold">Phone verification</h3><p className="mt-1 text-xs text-slate-500">{user.phoneVerified ? `Verified contact: ${user.patientPhone || ''}` : 'Verify your phone to keep a confirmed contact method on your patient account.'}</p></div>{user.phoneVerified && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Verified</span>}</div>{phoneCodeRequested ? <form action={confirmPhoneVerification} className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-52 flex-1 text-xs font-medium">Phone number<input name="phone" type="tel" required defaultValue={pendingPhone} className="field mt-2" /></label><label className="w-40 text-xs font-medium">Six-digit code<input name="otp" type="text" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required defaultValue={localPhoneCode} className="field mt-2" /></label><Button type="submit" size="small" disabled={busy}>Verify number</Button></form> : <form action={requestPhoneVerification} className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-52 flex-1 text-xs font-medium">Phone number<input name="phone" type="tel" required defaultValue={user.patientPhone || ''} placeholder="+1 555 123 4567" className="field mt-2" /></label><Button type="submit" size="small" disabled={busy}>{user.phoneVerified ? 'Send code to update phone' : 'Send verification code'}</Button></form>}</section>}
          {user.role === 'patient' && patientProfileQuery.data && <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div><h3 className="font-semibold">Patient profile and care history</h3><p className="mt-1 text-xs text-slate-500">Keep personal and emergency details up to date. Contact and address fields are encrypted at rest.</p></div><form action={updatePatientProfile} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><label className="text-xs font-medium">Date of birth<input name="birthDate" type="date" defaultValue={patientProfileQuery.data.birthDate} className="field mt-2" /></label><label className="text-xs font-medium">Sex<select name="sex" defaultValue={patientProfileQuery.data.sex} className="field mt-2"><option value="">Not specified</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="prefer_not_to_say">Prefer not to say</option></select></label><label className="text-xs font-medium">Blood group<select name="bloodGroup" defaultValue={patientProfileQuery.data.bloodGroup} className="field mt-2"><option value="">Not specified</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => <option key={group}>{group}</option>)}</select></label><label className="text-xs font-medium">Emergency contact name<input name="emergencyContactName" defaultValue={patientProfileQuery.data.emergencyContactName} maxLength={120} className="field mt-2" /></label><label className="text-xs font-medium">Emergency contact phone<input name="emergencyContactPhone" type="tel" defaultValue={patientProfileQuery.data.emergencyContactPhone} maxLength={40} className="field mt-2" /></label><label className="text-xs font-medium sm:col-span-2">Address<textarea name="address" defaultValue={patientProfileQuery.data.address} maxLength={1000} className="field mt-2 min-h-20" /></label><div className="sm:col-span-2 xl:col-span-3"><Button type="submit" size="small" disabled={busy}>Save profile</Button></div></form></section>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{dashboardMetrics.map((metric) => <Metric key={metric.label} {...metric} />)}</div>
          <div className="mt-6 grid gap-5 xl:grid-cols-[1.5fr_1fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">Appointment activity</h3><p className="mt-1 text-xs text-slate-400">Recent visits by day</p></div><span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-teal">Last 7 days</span></div><div className="h-64">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="visits" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0b8278" stopOpacity={0.25} /><stop offset="100%" stopColor="#0b8278" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#edf0f4" vertical={false} /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#8590a3', fontSize: 12 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8590a3', fontSize: 12 }} /><Tooltip /><Area type="monotone" dataKey="visits" stroke="#0b8278" strokeWidth={2.5} fill="url(#visits)" /></AreaChart></ResponsiveContainer> : <Empty title="No appointments yet" text="Booked visits will appear here." />}</div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><h3 className="font-semibold">Quick actions</h3><p className="mt-1 text-xs text-slate-400">Continue with a common workflow</p><div className="mt-4 space-y-2">{nav.slice(1).map((item) => <button key={item.id} onClick={() => setActiveTab(item.id)} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 p-3 text-left text-sm hover:border-teal/30 hover:bg-mist"><span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-50 text-teal"><item.icon size={17} /></span>{item.label}<ArrowRight size={16} className="ml-auto text-slate-400" /></button>)}</div></section></div>
        </motion.div>}
        {activeTab === 'appointments' && <section><div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-semibold">Appointments</h2><p className="mt-1 text-sm text-slate-500">Book a visit and follow each appointment through care.</p></div></div>
          {canBook && <form action={bookAppointment} className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <h3 className="mb-4 font-semibold">Book an appointment</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs font-semibold text-slate-500">Doctor<select name="doctorId" required className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm text-ink"><option value="">Choose a doctor</option>{(doctorsQuery.data || []).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.user.name} · {doctor.specialisation}</option>)}</select></label>
              <label className="text-xs font-semibold text-slate-500">Date and time<input name="startsAt" type="datetime-local" required min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm text-ink" /></label>
              <label className="text-xs font-semibold text-slate-500 sm:col-span-2">Reason for visit<input name="reason" maxLength={500} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm text-ink" placeholder="Brief reason" /></label>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              {['hospital_admin', 'receptionist'].includes(user.role) ? <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="emergency" className="accent-teal" /> Emergency booking (bypasses regular availability)</label> : <p className="text-xs text-slate-400">Available slots use UTC doctor schedules.</p>}
              <Button type="submit" disabled={busy}><CalendarDays size={16} /> Request visit</Button>
            </div>
          </form>}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-5"><div><h3 className="font-semibold">Appointments</h3><p className="mt-1 text-xs text-slate-400">{filteredAppointmentCount} matching appointments</p></div><div className="flex flex-wrap gap-2"><label className="relative"><span className="sr-only">Search appointments</span><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input type="search" value={appointmentQuery} onChange={(event) => { setAppointmentQuery(event.target.value); setAppointmentPage(1); }} placeholder="Search name, reason, or ID" className="field pl-9 sm:w-64" /></label><select aria-label="Filter appointment status" value={appointmentStatus} onChange={(event) => { setAppointmentStatus(event.target.value); setAppointmentPage(1); }} className="field sm:w-44"><option value="all">All statuses</option>{['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'].map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></div></div>
            {visibleAppointments.length ? <div className="divide-y divide-slate-100">{visibleAppointments.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-mist text-teal"><CalendarDays size={18} /></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.reason || 'Consultation'} <span className="font-normal text-slate-400">· #{item.id}</span></p><p className="mt-1 text-xs text-slate-500">{new Date(item.startsAt).toLocaleString()} · {user.role === 'patient' ? item.doctorName : item.patientName || item.doctorName}</p></div>
              {item.emergency && <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">Emergency</span>}
              <span className={'rounded-full px-3 py-1 text-xs font-semibold ' + (item.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : item.status === 'cancelled' || item.status === 'no_show' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700')}>{item.status.replaceAll('_', ' ')}</span>
              {item.status === 'pending' && canUpdateAppointment && <Button size="small" variant="secondary" onClick={() => changeStatus(item.id, 'confirmed')}>Confirm</Button>}
              {user.role === 'doctor' && item.status === 'confirmed' && <Button size="small" variant="secondary" onClick={() => changeStatus(item.id, 'in_progress')}>Start visit</Button>}
              {user.role === 'doctor' && item.status === 'in_progress' && <Button size="small" onClick={() => changeStatus(item.id, 'completed')}><Check size={14} /> Complete</Button>}
              {canUpdateAppointment && item.status === 'confirmed' && <Button size="small" variant="ghost" onClick={() => changeStatus(item.id, 'no_show')}>Mark no show</Button>}
              {['patient', 'hospital_admin', 'receptionist'].includes(user.role) && ['pending', 'confirmed'].includes(item.status) && <Button size="small" variant="ghost" onClick={() => cancelAppointment(item.id)}>Cancel</Button>}
            </div>)}</div> : <Empty title={appointments.length ? 'No matching appointments' : 'No appointments yet'} text={appointments.length ? 'Change the search or status filter to see more visits.' : 'Book a visit to start a care workflow.'} />}
            {filteredAppointmentCount > appointmentPageSize && <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><p className="text-xs text-slate-500">Page {appointmentPage} of {appointmentPageCount}</p><div className="flex gap-2"><Button size="small" variant="secondary" disabled={appointmentPage <= 1} onClick={() => setAppointmentPage((page) => Math.max(1, page - 1))}>Previous</Button><Button size="small" variant="secondary" disabled={appointmentPage >= appointmentPageCount} onClick={() => setAppointmentPage((page) => Math.min(appointmentPageCount, page + 1))}>Next</Button></div></div>}
          </div>
        </section>}
        {activeTab === 'clinical' && <section>
          <SectionTitle title="Clinical care" subtitle="Visit records, prescriptions, and secure downloads." />
          {user.role === 'doctor' && appointments.filter((a) => a.status === 'in_progress').map((appointment) => <div key={appointment.id} className="mb-5 grid gap-4 rounded-2xl border border-teal/20 bg-mist/60 p-5 xl:grid-cols-2">
            <form action={(form) => createRecord(appointment.id, form)} className="space-y-3 rounded-xl bg-white p-4"><h3 className="font-semibold">Visit note · appointment #{appointment.id}</h3><input name="chiefComplaint" placeholder="Chief complaint" className="field" /><textarea name="symptoms" placeholder="Symptoms" className="field min-h-20" /><textarea name="diagnosis" required placeholder="Diagnosis" className="field min-h-20" /><textarea name="treatmentPlan" placeholder="Treatment plan" className="field min-h-20" /><input name="allergies" placeholder="Allergies" className="field" /><div className="grid grid-cols-2 gap-2"><input name="bloodPressure" placeholder="Blood pressure" className="field" /><input name="pulseBpm" type="number" min="0" max="300" placeholder="Pulse bpm" className="field" /><input name="weightKg" type="number" min="1" max="500" step="0.1" placeholder="Weight kg" className="field" /><input name="heightCm" type="number" min="40" max="250" step="0.1" placeholder="Height cm" className="field" /></div><textarea name="medicalHistory" placeholder="Medical history" className="field min-h-16" /><textarea name="familyHistory" placeholder="Family history" className="field min-h-16" /><textarea name="surgicalHistory" placeholder="Surgical history" className="field min-h-16" /><textarea name="vaccinationHistory" placeholder="Vaccination history" className="field min-h-16" /><label className="block text-xs font-medium">Supporting file (PDF, PNG, or JPEG; max 5 MB)<input name="attachment" type="file" accept="application/pdf,image/png,image/jpeg" className="mt-2 block w-full text-xs" /></label><Button type="submit" size="small" disabled={busy}>Save and electronically sign</Button></form>
            <form action={(form) => createPrescription(appointment.id, form)} className="space-y-3 rounded-xl bg-white p-4"><h3 className="font-semibold">Prescription</h3><datalist id={'medicines-' + appointment.id}>{(medicinesQuery.data || []).map((medicine) => <option key={medicine.id} value={medicine.name} />)}</datalist>{[1, 2, 3].map((line) => <fieldset key={line} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-3"><legend className="px-1 text-xs font-semibold text-slate-500">Medicine {line}{line === 1 ? ' (required)' : ' (optional)'}</legend><input name={'medicineName' + line} required={line === 1} list={'medicines-' + appointment.id} placeholder="Medicine" className="field col-span-2" /><input name={'dosage' + line} required={line === 1} placeholder="Dosage" className="field" /><input name={'frequency' + line} required={line === 1} placeholder="Frequency" className="field" /><input name={'duration' + line} required={line === 1} placeholder="Duration" className="field" /><input name={'itemInstructions' + line} placeholder="Item instructions" className="field" /></fieldset>)}<input name="instructions" placeholder="Prescription instructions" className="field" /><Button type="submit" size="small" variant="secondary" disabled={busy}>Save signed prescription</Button></form>
          </div>)}
          <div className="grid gap-5 xl:grid-cols-2"><ServerPagedPanel<MedicalRecord> endpoint="/records/page" cacheKey="records" title="Visit records" icon={ClipboardList} empty="No medical records available." render={(record) => <div><b>Record #{record.id}</b><p className="mt-1 text-xs text-slate-500">{record.createdAt?.slice(0, 10)} · {record.diagnosis}</p><p className="mt-2 text-xs text-slate-500">Plan: {record.treatmentPlan || 'Not recorded'}{record.bmi ? ' · BMI ' + record.bmi : ''}</p>{record.signed && <p className="mt-2 text-xs font-semibold text-emerald-700">Electronically signed {record.signedAt ? '· ' + new Date(record.signedAt).toLocaleString() : ''}</p>}{record.attachments?.map((file) => <a key={file.id} className="mr-3 mt-2 inline-block text-xs font-semibold text-teal underline" href={'/api/attachments/' + file.id}>{file.name} ({Math.ceil(file.sizeBytes / 1024)} KB)</a>)}</div>} /><ServerPagedPanel<Prescription> endpoint="/prescriptions/page" cacheKey="prescriptions" title="Prescriptions" icon={FileText} empty="No prescriptions available." render={(rx) => <div className="flex items-center justify-between gap-3"><div><b>Prescription #{rx.id}</b><p className="mt-1 text-xs text-slate-500">{rx.items?.map((item) => item.medicineName + ' · ' + item.dosage).join(', ')}</p>{rx.signed && <p className="mt-1 text-xs font-semibold text-emerald-700">Electronically signed</p>}</div><a className="rounded-lg bg-mist px-3 py-2 text-xs font-semibold text-teal" href={'/api/prescriptions/' + rx.id + '/pdf'}>Download PDF</a></div>} /></div>
        </section>}
        {activeTab === 'laboratory' && <section><SectionTitle title="Laboratory" subtitle="Orders and results available to your role." />
          {user.role === 'doctor' && appointments.filter((a) => ['confirmed', 'in_progress', 'completed'].includes(a.status)).map((appointment) => <form key={'lab-' + appointment.id} action={(form) => createLabOrder(appointment.id, form)} className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4"><span className="mr-auto text-sm">Order for appointment #{appointment.id}</span><input name="testName" required placeholder="Test name" className="field max-w-56" /><input name="notes" placeholder="Notes" className="field max-w-64" /><Button type="submit" size="small" disabled={busy}>Order test</Button></form>)}
          <ServerPagedPanel<LabOrder> endpoint="/lab-orders/page" cacheKey="labs" title="Test orders" icon={FlaskConical} empty="No laboratory orders yet." render={(item) => <div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><b>{item.testName}</b><p className="mt-1 text-xs text-slate-500">{item.result || 'Result is being processed.'}</p></div><span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-teal">{item.status}</span>{user.role === 'lab_technician' && item.status === 'ordered' && <form action={(form) => uploadLabResult(item.id, form)} className="flex gap-2"><input name="result" required placeholder="Result text" className="field max-w-56" /><Button type="submit" size="small" disabled={busy}>Upload</Button></form>}{['doctor', 'hospital_admin'].includes(user.role) && item.status === 'result_uploaded' && <Button size="small" variant="secondary" onClick={() => approveLab(item.id)}>Approve</Button>}</div>} />
        </section>}
        {activeTab === 'billing' && <section><SectionTitle title="Billing" subtitle="Invoice charges and payment status." />
          {['hospital_admin', 'accountant', 'receptionist'].includes(user.role) && appointments.slice(0, 10).map((appointment) => <form key={'billing-' + appointment.id} action={(form) => createInvoice(appointment.id, form)} className="mb-3 rounded-xl border border-slate-200 bg-white p-4"><p className="mb-3 text-sm font-semibold">Invoice for appointment #{appointment.id} · {appointment.patientName}</p><div className="grid gap-2 sm:grid-cols-3">{[1, 2, 3].map((line) => <fieldset key={line} className="grid gap-2 rounded-lg border border-slate-100 p-3"><legend className="px-1 text-xs font-semibold text-slate-500">Charge {line}{line === 1 ? ' (required)' : ' (optional)'}</legend><input name={'description' + line} defaultValue={line === 1 ? 'Consultation' : ''} required={line === 1} placeholder="Description" className="field" /><input name={'quantity' + line} type="number" min="1" defaultValue="1" required={line === 1} aria-label={'Charge ' + line + ' quantity'} className="field" /><label className="text-xs text-slate-500">Unit price (₹)<input name={'amount' + line} type="number" min="0.01" step="0.01" defaultValue={line === 1 ? '250' : ''} required={line === 1} aria-label={'Charge ' + line + ' unit price'} className="field mt-1" /></label></fieldset>)}</div><Button type="submit" size="small" disabled={busy} className="mt-3">Create invoice</Button></form>)}
          <ServerPagedGrid<Invoice> endpoint="/billing/invoices/page" cacheKey="invoices" label="invoices" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" empty="No invoices" render={(invoice) => <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div className="flex items-start justify-between"><div><p className="text-xs text-slate-400">Invoice #{invoice.id}</p><h3 className="mt-2 text-2xl font-semibold">₹{invoice.amount.toLocaleString('en-IN')}</h3></div><Wallet className="text-teal" /></div><div className="mt-4 space-y-2 border-t border-slate-100 pt-4">{invoice.items?.map((line, i) => <p key={i} className="flex justify-between gap-2 text-xs text-slate-500"><span>{line.description} × {line.quantity}</span><span>₹{(line.totalMinor / 100).toLocaleString('en-IN')}</span></p>)}</div><div className="mt-4 flex items-center justify-between"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize">{invoice.status}</span>{user.role === 'patient' && invoice.status !== 'paid' && <Button size="small" onClick={() => payInvoice(invoice)}>Pay securely</Button>}</div></article>} />
        </section>}
        {activeTab === 'pharmacy' && <section><SectionTitle title="Pharmacy" subtitle="Medicine catalogue, expiry tracking, and prescription fulfilment." />
          {['hospital_admin', 'pharmacist'].includes(user.role) && <form action={createMedicine} className="mb-5 grid gap-2 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-4"><input name="name" required placeholder="Medicine name" className="field" /><input name="sku" required placeholder="SKU" className="field" /><input name="category" placeholder="Category" className="field" /><Button type="submit" disabled={busy}>Add medicine</Button></form>}
          <ServerPagedGrid<Medicine> endpoint="/medicines/page" cacheKey="medicines" label="medicines" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" empty="No medicines in the catalogue" render={(medicine) => <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div className="flex justify-between gap-3"><div><b>{medicine.name}</b><p className="mt-1 text-xs text-slate-400">{medicine.sku} · {medicine.category}</p></div><span className="h-fit rounded-full bg-mist px-3 py-1 text-xs font-semibold text-teal">{medicine.available} {medicine.unit}</span></div><div className="mt-3 flex flex-wrap gap-2">{medicine.lowStock && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Low stock</span>}{medicine.expiredQuantity > 0 && <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">Expired: {medicine.expiredQuantity}</span>}</div><p className="mt-3 text-xs text-slate-500">Reorder at {medicine.reorderLevel}</p><form action={(form) => receiveBatch(medicine.id, form)} className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4"><input name="batchNumber" required placeholder="Batch number" className="field" /><input name="expiryDate" required type="date" className="field" /><input name="quantity" required min="1" type="number" placeholder="Quantity" className="field" /><input name="unitCost" required min="0" step="0.01" type="number" placeholder="Unit cost ₹" className="field" /><Button size="small" type="submit" disabled={busy} className="col-span-2">Receive stock</Button></form></article>} />
          {user.role === 'pharmacist' && <div className="mt-6"><ServerPagedPanel<Prescription> endpoint="/prescriptions/page" cacheKey="prescriptions" params={{ dispensed: 'false' }} title="Prescriptions to dispense" icon={FileText} empty="No prescriptions need dispensing" render={(rx) => <form action={(form) => dispensePrescription(rx.id, rx.items, form)} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="mb-3 text-sm font-semibold">Prescription #{rx.id} · Patient #{rx.patientId}</p><div className="grid gap-2 sm:grid-cols-2">{rx.items.map((item) => <label key={item.id} className="text-xs text-slate-500">{item.medicineName} · {item.dosage}<input name={'quantity-' + item.id} required type="number" min="1" defaultValue="1" className="field mt-1" /></label>)}</div><Button size="small" type="submit" disabled={busy} className="mt-3">Dispense</Button></form>} /></div>}</section>}
        {activeTab === 'notifications' && <section><SectionTitle title="Notifications" subtitle="Recent updates from your care team." /><ServerPagedPanel<NotificationItem> endpoint="/notifications/me/page" cacheKey="notifications" title="Recent activity" icon={Bell} empty="You are all caught up." render={(item) => <div><div className="flex items-center gap-2"><b>{item.title}</b>{!item.readAt && <span className="h-2 w-2 rounded-full bg-teal" />}</div><p className="mt-1 text-xs text-slate-500">{item.body}</p><p className="mt-1 text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleString()}</p></div>} /></section>}
        <footer className="mt-12 border-t border-slate-200 pt-5 text-xs text-slate-400">MedCore HMS · Local academic demo · Use invented data only</footer>
      </div>
    </main>
    <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
  </div>;
}

function Field(props: InputHTMLAttributes<HTMLInputElement> & { label: string }) { const { label, ...rest } = props; return <label className="block text-sm font-medium">{label}<input {...rest} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-teal focus:ring-2 focus:ring-teal/15" /></label>; }
function Metric({ icon: Icon, label, value, foot }: { icon: LucideIcon; label: string; value: string | number; foot: string }) { return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div className="flex items-start justify-between"><span className="text-xs font-medium text-slate-500">{label}</span><span className="grid h-9 w-9 place-items-center rounded-xl bg-mist text-teal"><Icon size={18} /></span></div><p className="mt-4 text-3xl font-semibold">{value}</p><p className="mt-1 text-xs text-slate-400">{foot}</p></article>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="grid min-h-40 place-items-center p-7 text-center"><div><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-slate-400">{text}</p></div></div>; }
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div className="mb-6"><h2 className="text-2xl font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>; }
function ServerPagedPanel<T extends { id: number }>({ endpoint, cacheKey, title, icon: Icon, empty, params = {}, render }: { endpoint: string; cacheKey: string; title: string; icon: LucideIcon; empty: string; params?: Record<string, string>; render: (row: T) => ReactNode }) {
  const userId = useSessionStore((state) => state.user?.id);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const result = useServerPage<T>(endpoint, cacheKey, userId, page, pageSize, query, params);
  const data = result.data;
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-mist text-teal"><Icon size={17} /></span><h3 className="font-semibold">{title}</h3></div><label className="relative"><span className="sr-only">Search {title.toLowerCase()}</span><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search this list" className="field pl-9 sm:w-48" /></label></div>{result.isPending ? <Empty title="Loading" text="Getting the latest records." /> : result.isError ? <Empty title="Could not load this list" text="Check your connection and try again." /> : data?.items.length ? <div className="divide-y divide-slate-100">{data.items.map((row) => <div key={row.id} className="p-5">{render(row)}</div>)}</div> : <Empty title={query ? 'No matching items' : empty} text={query ? 'Change your search to find another item.' : 'Updates will appear here as you use the system.'} />}{data && data.totalPages > 1 && <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><p className="text-xs text-slate-500">{data.total} results · page {data.page} of {data.totalPages}</p><div className="flex gap-2"><Button size="small" variant="secondary" disabled={data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button size="small" variant="secondary" disabled={data.page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>}</section>;
}
function ServerPagedGrid<T extends { id: number }>({ endpoint, cacheKey, params = {}, label, className, empty, render }: { endpoint: string; cacheKey: string; params?: Record<string, string>; label: string; className: string; empty: string; render: (row: T) => ReactNode }) {
  const userId = useSessionStore((state) => state.user?.id);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 9;
  const result = useServerPage<T>(endpoint, cacheKey, userId, page, pageSize, query, params);
  const data = result.data;
  return <div><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><label className="relative"><span className="sr-only">Search {label}</span><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={'Search ' + label} className="field pl-9 sm:w-64" /></label><span className="text-xs text-slate-500">{data?.total ?? 0} {label}</span></div>{result.isPending ? <Empty title="Loading" text="Getting the latest records." /> : result.isError ? <Empty title="Could not load this list" text="Check your connection and try again." /> : data?.items.length ? <div className={className}>{data.items.map((row) => <div key={row.id}>{render(row)}</div>)}</div> : <Empty title={query ? 'No matching items' : empty} text={query ? 'Change your search to find another item.' : 'Items will appear here as you use the system.'} />}{data && data.totalPages > 1 && <div className="mt-3 flex items-center justify-between"><p className="text-xs text-slate-500">Page {data.page} of {data.totalPages}</p><div className="flex gap-2"><Button size="small" variant="secondary" disabled={data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button size="small" variant="secondary" disabled={data.page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>}</div>;
}
function useServerPage<T>(endpoint: string, cacheKey: string, userId: number | undefined, page: number, pageSize: number, query: string, extra: Record<string, string>) {
  const extraKey = Object.entries(extra).sort(([a], [b]) => a.localeCompare(b));
  return useQuery({
    queryKey: [cacheKey, 'page', userId, page, pageSize, query, extraKey],
    enabled: userId !== undefined,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (query.trim()) params.set('q', query.trim().slice(0, 100));
      for (const [key, value] of Object.entries(extra)) params.set(key, value);
      return data(await api<Envelope<PagedResult<T>>>(endpoint + '?' + params.toString()));
    },
  });
}
