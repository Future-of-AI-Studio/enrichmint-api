import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class FeedbackDto {
  @ApiProperty({ enum: ['GUIDE', 'RESPONSE'] })
  @IsIn(['GUIDE', 'RESPONSE'])
  targetType: 'GUIDE' | 'RESPONSE';

  @ApiProperty({
    description: 'Guide id, or request id for a personal response.',
  })
  @IsString()
  @MaxLength(40)
  targetId: string;

  @ApiProperty({ enum: ['IMMEDIATE', 'FOLLOW_UP'] })
  @IsIn(['IMMEDIATE', 'FOLLOW_UP'])
  phase: 'IMMEDIATE' | 'FOLLOW_UP';

  @ApiPropertyOptional({ description: 'Immediate: was this relevant?' })
  @IsOptional()
  @IsBoolean()
  relevant?: boolean;

  @ApiPropertyOptional({
    description: 'Immediate: did it help you identify a next step?',
  })
  @IsOptional()
  @IsBoolean()
  nextStep?: boolean;

  @ApiPropertyOptional({
    description: 'Immediate: anything missing or misleading?',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  missingOrMisleading?: string;

  @ApiPropertyOptional({ description: 'Follow-up: did you try the guidance?' })
  @IsOptional()
  @IsBoolean()
  tried?: boolean;

  @ApiPropertyOptional({ description: 'Follow-up: what happened?' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outcome?: string;

  @ApiPropertyOptional({
    description: 'Follow-up: was it useful after applying it?',
  })
  @IsOptional()
  @IsBoolean()
  usefulAfter?: boolean;
}

export class ReportDto {
  @ApiProperty({ enum: ['GUIDE', 'REQUEST', 'RESPONSE', 'USER'] })
  @IsIn(['GUIDE', 'REQUEST', 'RESPONSE', 'USER'])
  targetType: string;

  @ApiProperty()
  @IsString()
  @MaxLength(40)
  targetId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  reason: string;
}

export class ResolveReportDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  resolution: string;
}
