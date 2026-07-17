CREATE INDEX "Teacher_city_district_createdAt_idx"
ON "Teacher"("city", "district", "createdAt");

CREATE INDEX "Teacher_createdAt_idx"
ON "Teacher"("createdAt");
