# NCDs 3 Diseases Data

## Diseases and ICD-10 Codes

The following diseases and their ICD-10 codes are included:

1. Diabetes Mellitus (DM)

   - Description: Various types of diabetes
   - Main ICD-10 codes: E10, E101, E102, E103, E104, E105, E106, E107, E108, E109, E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129, E13, E131, E132, E133, E134, E135, E136, E137, E138, E139, E14, E141, E142, E143, E144, E145, E146, E147, E148, E149

2. Diabetes with DKA (Diabetic Ketoacidosis)

   - Description: Diabetes with high blood sugar condition
   - Main ICD-10 codes: E101, E111, E121, E131, E141

3. Diabetes with Diabetic Nephropathy (DN)

   - Description: Diabetes with chronic kidney disease
   - Main ICD-10 codes: E10, E11, E12, E13, E14, E102, E112, E122, E132, E142
   - Secondary codes: N18

4. Diabetes with Acute Coronary Syndrome (ACS)

   - Description: Diabetes with ischemic heart disease
   - Main ICD-10 codes: E102, E112, E122, E132, E142
   - Secondary codes: I20, I21, I22, I23, I24, I25

5. Diabetes with Stroke

   - Description: Diabetes with cerebrovascular disease
   - Main ICD-10 codes: E10, E11, E12, E13, E14
   - Secondary codes: I63, I65, I66, I69.3

6. Hypertension (HT)

   - Description: Various types of high blood pressure
   - Main ICD-10 codes: I10, I15, I150, I151, I152, I158, I159, I16

7. Well-controlled Hypertension (Age < 65)

   - Description: Patients under 65 years with SBP ≤ 130
   - Main ICD-10 codes: I10, I150, I151, I152, I158, I159, I16
   - Criteria: Age less than 65 years
   - OPD file requirement: SBP ≤ 130

8. Well-controlled Hypertension (Age ≥ 65)

   - Description: Patients 65 years or older with SBP ≤ 140
   - Main ICD-10 codes: I10, I150, I151, I152, I158, I159, I16
   - Criteria: Age 65 years or older
   - OPD file requirement: SBP ≤ 140

9. Chronic Kidney Disease (CKD)

   - Description: Chronic kidney disease
   - Main ICD-10 codes: N18, N181, N182, N183, N1830, N1831, N1832, N184, N185, N186, N189

10. CKD Stage 3

    - Description: Chronic kidney disease stage 3
    - Main ICD-10 codes: N183

11. CKD Stage 4

    - Description: Chronic kidney disease stage 4
    - Main ICD-10 codes: N184

12. CKD Stage 5

    - Description: Chronic kidney disease stage 5
    - Main ICD-10 codes: N185

13. CKD Stage 5 (Non-dialysis)

    - Description: Chronic kidney disease stage 5 without dialysis
    - Main ICD-10 codes: N185
    - Secondary codes: Not have Z49.1, Z49.2
    - ICD-9 requirement: Not have 39.95, 54.89

14. CKD Stage 5 (Dialysis)
    - Description: Chronic kidney disease stage 5 with dialysis
    - Main ICD-10 codes: N185
    - Secondary codes: Have Z49.1, Z49.2
    - ICD-9 requirement: Have 39.95, 54.90

## Data Calculations

### Service Performance Data

#### Service Proportion Metrics

1. Diabetes Patients

- A: Match "diag_nosis.dxtype" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then count "cid"

2. Average Diabetes Visits

- A: Match "diag_nosis.dxtype" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then count "transaction_uid" divide by count "cid"

3. Hypertension Patients

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 then count "cid"

4. Average Hypertension Visits

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 then count "transaction_uid" divide by count "cid"

5. CKD Patients

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N18, N181, N182, N183, N1830, N1831, N1832, N184, N185, N186, N189 then count "cid"

6. Average CKD Visits

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N18, N181, N182, N183, N1830, N1831, N1832, N184, N185, N186, N189 then count "transaction_uid" divide by count "cid"

#### Service Performance Charts

1. Total Patients

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 or I10, I15, I150, I151, I152, I158, I159, I16 or N18, N181, N182, N183, N1830, N1831, N1832, N184, N185, N186, N189 then count "cid"

2. Diabetes Patients

- A: Match "diag_nosis.dxtype" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then count "cid"

3. Hypertension Patients

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 then count "cid"

4. CKD Patients

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N18, N181, N182, N183, N1830, N1831, N1832, N184, N185, N186, N189 then count "cid"

#### Diabetes Patient Distribution Chart

1. DM with DKA

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then count "cid"

2. DM with DN (If Condition A isn't true, then check Condition B)

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E10, E11, E12, E13, E14 and "diag_nosis.dx_type" != 1, "diag_nosis.diag" != N18 then count "cid"
- B: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E102, E112, E122, E132, E142 then count "cid"

3. DM with ACS

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E10, E11, E12, E13, E14 and "diag_nosis.dx_type" != 1, "diag_nosis.diag" != I20, I21, I22, I23, I24, I25 then count "cid"

4. DM with Stroke

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E10, E11, E12, E13, E14 and "diag_nosis.dx_type" != 1, "diag_nosis.diag" != I63, I65, I66, I69.3 then count "cid"

5. Other DM

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then count "cid" - (Sum of above 4 categories)

#### Hypertension Patient Distribution Chart

1. Well-controlled HT (Age < 65)

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 and "pat.dob" < 1964-01-01 then count "cid"

2. Well-controlled HT (Age ≥ 65)

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 and "pat.dob" >= 1964-01-01 then count "cid"

3. Other HT

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 then count "cid" - (Sum of above 2 categories)

#### CKD Patient Distribution Chart

1. CKD Stage 3

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N183 then count "cid"

2. CKD Stage 4

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N184 then count "cid"

3. CKD Stage 5

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N185 then count "cid"

4. CKD Stage 5 Non-dialysis

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = N185, "diag_nosis.dx_type" != 1, "diag_nosis.diag" != Z491 and Z492 and "procedure.oper" != 39.95 and 54.89 then count "cid"

5. CKD Stage 5 Dialysis (If Condition A isn't true, then check Condition B)

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = N185, "diag_nosis.dx_type" != 1, "diag_nosis.diag" != Z491 and "procedure.oper" = 39.95 or 54.90 then count "cid"
- B: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = N185, "diag_nosis.dx_type" != 1, "diag_nosis.diag" != Z492 and "procedure.oper" != 54.89 then count "cid"

### Service Cost Data (Billing Amount)

#### Service Cost Proportion Metrics

1. Diabetes Costs

- A: Match "diag_nosis.dxtype" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then sum "total"

2. Average Diabetes Cost per Visit

- A: Match "diag_nosis.dxtype" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then sum "total" divide by count "transaction_uid"

3. Hypertension Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 then sum "total"

4. Average Hypertension Cost per Visit

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 then sum "total" divide by count "transaction_uid"

5. CKD Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N18, N181, N182, N183, N1830, N1831, N1832, N184, N185, N186, N189 then sum "total"

6. Average CKD Cost per Visit

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N18, N181, N182, N183, N1830, N1831, N1832, N184, N185, N186, N189 then sum "total" divide by count "transaction_uid"

#### Service Cost Charts

1. Total Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 or I10, I15, I150, I151, I152, I158, I159, I16 or N18, N181, N182, N183, N1830, N1831, N1832, N184, N185, N186, N189 then sum "total"

2. Diabetes Costs

- A: Match "diag_nosis.dxtype" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then sum "total"

3. Hypertension Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 then sum "total"

4. CKD Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N18, N181, N182, N183, N1830, N1831, N1832, N184, N185, N186, N189 then sum "total"

#### Diabetes Cost Distribution Chart

1. DM with DKA Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then sum "total"

2. DM with DN Costs (If Condition A isn't true, then check Condition B)

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E10, E11, E12, E13, E14 and "diag_nosis.dx_type" != 1, "diag_nosis.diag" != N18 then sum "total"
- B: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E102, E112, E122, E132, E142 then sum "total"

3. DM with ACS Costs

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E10, E11, E12, E13, E14 and "diag_nosis.dx_type" != 1, "diag_nosis.diag" != I20, I21, I22, I23, I24, I25 then sum "total"

4. DM with Stroke Costs

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E10, E11, E12, E13, E14 and "diag_nosis.dx_type" != 1, "diag_nosis.diag" != I63, I65, I66, I69.3 then sum "total"

5. Other DM Costs

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = E10, E101, E102, E103, E104, E105, E106, E107, E108, E109 E11, E111, E112, E113, E114, E115, E116, E117, E118, E119 E12, E121, E122, E123, E124, E125, E126, E127, E128, E129 E13, E131, E132, E133, E134, E135, E136, E137, E138, E139 E14, E141, E142, E143, E144, E145, E146, E147, E148, E149 then sum "total" - (Sum of above 4 categories)

#### Hypertension Cost Distribution Chart

1. Well-controlled HT Costs (Age < 65)

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 and "pat.dob" < 1964-01-01 then sum "total"

2. Well-controlled HT Costs (Age ≥ 65)

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 and "pat.dob" >= 1964-01-01 then sum "total"

3. Other HT Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = I10, I15, I150, I151, I152, I158, I159, I16 then sum "total" - (Sum of above 2 categories)

#### CKD Cost Distribution Chart

1. CKD Stage 3 Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N183 then sum "total"

2. CKD Stage 4 Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N184 then sum "total"

3. CKD Stage 5 Costs

- A: Match "diag_nosis.dx_type" = 1 and "diag_nosis.diag" = N185 then sum "total"

4. CKD Stage 5 Non-dialysis Costs

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = N185, "diag_nosis.dx_type" != 1, "diag_nosis.diag" != Z491 and Z492 and "procedure.oper" != 39.95 and 54.89 then sum "total"

5. CKD Stage 5 Dialysis Costs (If Condition A isn't true, then check Condition B)

- A: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = N185, "diag_nosis.dx_type" != 1, "diag_nosis.diag" != Z491 and "procedure.oper" = 39.95 or 54.90 then sum "total"
- B: Match "diag_nosis.dx_type" = 1, "diag_nosis.diag" = N185, "diag_nosis.dx_type" != 1, "diag_nosis.diag" != Z492 and "procedure.oper" != 54.89 then sum "total"
