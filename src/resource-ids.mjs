// 서버가 확인한 경로로만 자원을 정합니다. 쿼리·본문·요청 헤더의 ID는 믿지 않습니다.
export const RESOURCE_IDS = Object.freeze({
  personalNotes: 'personal_notes',
  instructorNotices: 'instructor_notices',
  instructorMaterials: 'instructor_materials',
  noticeManagement: 'notice_management',
});

const RESOURCES = [
  ['/api/learning-notes', RESOURCE_IDS.personalNotes],
  ['/api/instructor-notices', RESOURCE_IDS.instructorNotices],
  ['/api/instructor-materials', RESOURCE_IDS.instructorMaterials],
  ['/api/admin/instructor-notices', RESOURCE_IDS.noticeManagement],
];

export function resourceForPath(pathname) {
  if (typeof pathname !== 'string') return null;
  for (const [base, resourceId] of RESOURCES) {
    if (pathname === base || pathname === `${base}/`) {
      return Object.freeze({ resourceId, itemId: null });
    }
    if (!pathname.startsWith(`${base}/`)) continue;
    const itemId = pathname.slice(base.length + 1).replace(/\/$/u, '');
    if (itemId && !/[\/\\?#]/u.test(itemId)) return Object.freeze({ resourceId, itemId });
  }
  return null;
}
