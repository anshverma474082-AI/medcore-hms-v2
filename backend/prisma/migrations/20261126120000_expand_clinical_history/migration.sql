ALTER TABLE "MedicalRecord"
  ADD COLUMN "medicalHistoryEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "familyHistoryEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "surgicalHistoryEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "vaccinationHistoryEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "heightCm" DECIMAL(5,1),
  ADD COLUMN "bmi" DECIMAL(5,2);
