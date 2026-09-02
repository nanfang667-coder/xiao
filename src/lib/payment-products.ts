export const MEMBERSHIP_PRODUCT_TYPE = "membership";
export const ALLEY_POST_PRODUCT_TYPE = "alley_post";
export const TEACHER_POST_PRODUCT_TYPE = "teacher_post";

export const SINGLE_POST_UNLOCK_PLAN = {
  name: "单篇永久解锁",
  price: 10,
} as const;

export const ALLEY_UNLOCK_PLAN = SINGLE_POST_UNLOCK_PLAN;
export const TEACHER_UNLOCK_PLAN = SINGLE_POST_UNLOCK_PLAN;

export type OrderProductType =
  | typeof MEMBERSHIP_PRODUCT_TYPE
  | typeof ALLEY_POST_PRODUCT_TYPE
  | typeof TEACHER_POST_PRODUCT_TYPE;

function validId(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

export function isValidOrderProductTarget(
  productType: string,
  alleyPostId: number | null,
  teacherPostId: number | null,
): boolean {
  if (productType === MEMBERSHIP_PRODUCT_TYPE) {
    return alleyPostId === null && teacherPostId === null;
  }
  if (productType === ALLEY_POST_PRODUCT_TYPE) {
    return validId(alleyPostId) && teacherPostId === null;
  }
  if (productType === TEACHER_POST_PRODUCT_TYPE) {
    return alleyPostId === null && validId(teacherPostId);
  }
  return false;
}

export function paidOrderDestination(
  productType: string,
  alleyPostId: number | null,
  teacherPostId: number | null,
): string | null {
  if (!isValidOrderProductTarget(productType, alleyPostId, teacherPostId)) {
    return null;
  }
  if (productType === MEMBERSHIP_PRODUCT_TYPE) return "/vip?paid=1";
  if (productType === ALLEY_POST_PRODUCT_TYPE && alleyPostId !== null) {
    return `/alley/${alleyPostId}?paid=1`;
  }
  if (productType === TEACHER_POST_PRODUCT_TYPE && teacherPostId !== null) {
    return `/listing/${teacherPostId}?paid=1`;
  }
  return null;
}