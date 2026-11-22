import { NextRequest, NextResponse } from 'next/server';
import { planBuilderConfig } from '@/lib/plan-builder/constants';
import { staff } from '@/lib/plan-builder/route-helpers';

export async function GET(req: NextRequest) {
  const { denied } = await staff(req);
  if (denied) return denied;
  return NextResponse.json(planBuilderConfig());
}
