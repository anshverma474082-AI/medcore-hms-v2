import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppointmentStatus, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { encryptClinicalText } from '../src/security/data-protection';

dotenv.config({ path: resolve(process.cwd(), '../.env') });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const demoPassword = process.env.DEMO_PASSWORD || 'DemoPass123!';
const specs = ['General Medicine', 'Cardiology', 'Pediatrics', 'Dermatology'];

async function main() {
  const passwordHash = await bcrypt.hash(demoPassword, Number(process.env.BCRYPT_ROUNDS || 12));
  const superAdmin = await prisma.user.upsert({ where: { email: 'superadmin@medcore.demo' }, update: { passwordHash }, create: { name: 'Platform Admin', email: 'superadmin@medcore.demo', passwordHash, role: Role.SUPER_ADMIN, emailVerified: true } });
  for (const [hospitalName, code, slug] of [['City Hospital', 'CITY-1', 'city'], ['Northside Clinic', 'NORTH-1', 'north']] as const) {
    const hospital = await prisma.hospital.upsert({ where: { code }, update: { name: hospitalName, verified: true }, create: { name: hospitalName, code, verified: true } });
    const admin = await prisma.user.upsert({ where: { email: 'admin@' + slug + '.example' }, update: { hospitalId: hospital.id, passwordHash, isActive: true }, create: { hospitalId: hospital.id, name: slug === 'city' ? 'Asha Mehta' : 'Mohan Rao', email: 'admin@' + slug + '.example', passwordHash, role: Role.HOSPITAL_ADMIN, emailVerified: true } });
    const departments = [];
    for (const name of specs) departments.push(await prisma.department.upsert({ where: { hospitalId_name: { hospitalId: hospital.id, name } }, update: {}, create: { hospitalId: hospital.id, name } }));
    const doctors = [];
    for (let i = 0; i < 4; i++) {
      const email = 'doctor' + (i + 1) + '@' + slug + '.example';
      const user = await prisma.user.upsert({ where: { email }, update: { hospitalId: hospital.id, passwordHash, isActive: true }, create: { hospitalId: hospital.id, name: ['Ananya Rao', 'Kabir Shah', 'Mira Nair', 'Arjun Das'][i], email, passwordHash, role: Role.DOCTOR, emailVerified: true } });
      const doctor = await prisma.doctor.upsert({ where: { userId: user.id }, update: { hospitalId: hospital.id, departmentId: departments[i].id, specialisation: specs[i], deletedAt: null }, create: { userId: user.id, hospitalId: hospital.id, departmentId: departments[i].id, specialisation: specs[i] } });
      doctors.push(doctor);
      await prisma.doctorAvailability.upsert({ where: { doctorId_weekday_startMinute_endMinute: { doctorId: doctor.id, weekday: 0, startMinute: 540, endMinute: 1020 } }, update: { active: true, slotMinutes: 30 }, create: { hospitalId: hospital.id, doctorId: doctor.id, weekday: 0, startMinute: 540, endMinute: 1020, slotMinutes: 30 } });
    }
    const patients = [];
    for (let i = 1; i <= 15; i++) {
      const email = 'patient' + String(i).padStart(2, '0') + '@' + slug + '.example';
      const user = await prisma.user.upsert({ where: { email }, update: { hospitalId: hospital.id, passwordHash, isActive: true, emailVerified: true }, create: { hospitalId: hospital.id, name: ['Riya Sen', 'Dev Patel', 'Isha Kapoor', 'Neel Joshi', 'Tara Bose'][i % 5] + ' ' + i, email, passwordHash, role: Role.PATIENT, emailVerified: true } });
      patients.push(await prisma.patient.upsert({ where: { userId: user.id }, update: { hospitalId: hospital.id, deletedAt: null }, create: { userId: user.id, hospitalId: hospital.id, phone: '+910000000' + String(i).padStart(3, '0') } }));
    }
    const staff = [
      ['nurse@' + slug + '.example', 'Nisha Nurse', Role.NURSE],
      ['reception@' + slug + '.example', 'Rohan Reception', Role.RECEPTIONIST],
      ['lab@' + slug + '.example', 'Leena Lab', Role.LAB_TECHNICIAN],
      ['pharmacy@' + slug + '.example', 'Parth Pharmacy', Role.PHARMACIST],
      ['accounts@' + slug + '.example', 'Amit Accounts', Role.ACCOUNTANT],
    ] as const;
    for (const [email, name, role] of staff) await prisma.user.upsert({ where: { email }, update: { hospitalId: hospital.id, passwordHash, isActive: true }, create: { hospitalId: hospital.id, name, email, passwordHash, role, emailVerified: true } });

    for (let day = 13; day >= 0; day--) {
      const startsAt = new Date(); startsAt.setUTCHours(10, 0, 0, 0); startsAt.setUTCDate(startsAt.getUTCDate() - day);
      const patient = patients[day % patients.length]; const doctor = doctors[day % doctors.length];
      let appointment = await prisma.appointment.findFirst({ where: { hospitalId: hospital.id, patientId: patient.id, doctorId: doctor.id, startsAt } });
      if (!appointment) appointment = await prisma.appointment.create({ data: { hospitalId: hospital.id, patientId: patient.id, doctorId: doctor.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), status: AppointmentStatus.COMPLETED, reason: 'Routine follow-up' } });
      if (day === 2 && !await prisma.medicalRecord.findUnique({ where: { appointmentId: appointment.id } })) {
        await prisma.medicalRecord.create({ data: { hospitalId: hospital.id, appointmentId: appointment.id, patientId: patient.id, doctorId: doctor.id, chiefComplaintEncrypted: encryptClinicalText('Routine follow-up'), symptomsEncrypted: encryptClinicalText('No urgent symptoms reported'), diagnosisEncrypted: encryptClinicalText('Routine check completed'), treatmentPlanEncrypted: encryptClinicalText('Continue usual care; follow up if needed'), allergiesEncrypted: encryptClinicalText('No known allergies reported'), bloodPressure: '118/76', pulseBpm: 72, temperatureC: 36.7, spo2Percent: 98, weightKg: 64.2 } });
        const prescription = await prisma.prescription.create({ data: { hospitalId: hospital.id, appointmentId: appointment.id, patientId: patient.id, doctorId: doctor.id, instructionsEncrypted: encryptClinicalText('Take only as directed by your clinician.'), items: { create: [{ medicineName: 'Demo medicine', dosage: 'As directed', frequency: 'As prescribed', duration: 'As prescribed', instructions: '' }] } } });
        const medicine = await prisma.medicine.upsert({ where: { hospitalId_name: { hospitalId: hospital.id, name: 'Demo medicine' } }, update: {}, create: { hospitalId: hospital.id, name: 'Demo medicine', sku: 'DEMO-' + slug.toUpperCase(), category: 'Example', unit: 'tablet' } });
        await prisma.inventoryBatch.upsert({ where: { medicineId_batchNumber: { medicineId: medicine.id, batchNumber: 'DEMO-BATCH-' + slug } }, update: { quantityRemaining: 50 }, create: { hospitalId: hospital.id, medicineId: medicine.id, batchNumber: 'DEMO-BATCH-' + slug, expiryDate: new Date(Date.now() + 365 * 86400_000), quantityReceived: 50, quantityRemaining: 50, unitCostMinor: 100 } });
        const invoice = await prisma.invoice.create({ data: { hospitalId: hospital.id, appointmentId: appointment.id, patientId: patient.id, amountMinor: 25000, currency: 'INR', items: { create: [{ description: 'Consultation', quantity: 1, unitMinor: 25000, totalMinor: 25000 }] } } });
        void prescription; void invoice;
      }
    }
    await prisma.auditLog.create({ data: { hospitalId: hospital.id, userId: admin.id, action: 'SEED', entity: 'Hospital' } });
  }
  console.log('Seed complete: 2 hospitals, 8 doctors, 30 patients, 28 appointments, sample prescriptions and invoices.');
  console.log('Demo logins use DEMO_PASSWORD or the README default.');
  void superAdmin;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
