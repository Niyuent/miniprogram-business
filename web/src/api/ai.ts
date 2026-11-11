import { http } from '@/utils/request';

export interface RecentScan {
  id: number;
  name: string;
  minutesAgo: number;
}

export interface IdentifyUserResult {
  suggestedUserId: number;
  confidence: number;
  fallbackUsed: boolean;
}

export interface AbnormalAnalysis {
  suggestion: string;
  confidence: number;
  reasons: string[];
  fallbackUsed: boolean;
}

export interface LicenseRecognition {
  companyName: string;
  creditCode: string;
  legalName: string;
  source: 'mock';
  imageCount: number;
  note: string;
  form: { companyName: string; creditCode: string; legalName: string };
}

export const aiApi = {
  identifyUser(payload: { voiceText: string; recentScans: RecentScan[] }) {
    return http<IdentifyUserResult>({ url: '/ai/identify-user', method: 'POST', data: payload });
  },
  analyzeAbnormal(orderId: number) {
    return http<AbnormalAnalysis>({ url: '/ai/analyze-abnormal', method: 'POST', data: { orderId } });
  },
  recognizeLicense(merchantId: number) {
    return http<LicenseRecognition>({ url: '/ai/recognize-license', method: 'POST', data: { merchantId } });
  },
};
