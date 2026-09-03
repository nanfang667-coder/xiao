export type TeacherPostFields = {
  name: string;
  type: string;
  city: string;
  district: string;
  price: string;
  services: string;
  courseNotes: string | null;
  age: string | null;
  phone: string;
  wechat: string;
  qq: string | null;
  otherContact: string | null;
  address: string | null;
};

function field(formData: FormData, key: string, maxLength: number): string {
  const value = String(formData.get(key) ?? "").trim();
  if (value.length > maxLength) throw new Error(`${key} is too long`);
  return value;
}

function optional(value: string): string | null {
  return value || null;
}

export function extractTeacherPostFields(formData: FormData): TeacherPostFields {
  const name = field(formData, "name", 100);
  const services = field(formData, "services", 4_000);
  const phone = field(formData, "phone", 100);
  const wechat = field(formData, "wechat", 100);
  const qq = optional(field(formData, "qq", 100));
  const otherContact = optional(field(formData, "otherContact", 300));

  if (!name || !services) {
    throw new Error("name and services are required");
  }
  if (!phone && !wechat && !qq && !otherContact) {
    throw new Error("at least one contact method is required");
  }

  return {
    name,
    type: "钢琴",
    city: field(formData, "city", 50),
    district: field(formData, "district", 50),
    price: field(formData, "price", 100),
    services,
    courseNotes: optional(field(formData, "courseNotes", 10_000)),
    age: optional(field(formData, "age", 50)),
    phone,
    wechat,
    qq,
    otherContact,
    address: optional(field(formData, "address", 500)),
  };
}
