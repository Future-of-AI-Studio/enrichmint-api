import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class GuideSectionDto {
  @ApiProperty({ example: 'actions' })
  @IsString()
  @MaxLength(40)
  key: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty()
  @IsString()
  @MaxLength(12000)
  body: string;
}

export class GuideGapDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  key: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  question: string;
}

export class UpdateDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  summary?: string;

  @ApiPropertyOptional({ description: 'Free preview shown before purchase.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preview?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  audience?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  limitations?: string;

  @ApiPropertyOptional({ type: [GuideSectionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => GuideSectionDto)
  sections?: GuideSectionDto[];

  @ApiPropertyOptional({ type: [GuideGapDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GuideGapDto)
  gaps?: GuideGapDto[];
}

export class UpdateGuideSettingsDto {
  @ApiPropertyOptional({ description: 'Guide price in cents.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  priceCents?: number;

  @ApiPropertyOptional({
    description:
      'Whether AI may read this guide to help people who bought it. Reading access for buyers is separate and always included.',
  })
  @IsOptional()
  @IsBoolean()
  agentAssistAllowed?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  topics?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string;
}

export class ListGuidesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ReviewDecisionDto {
  @ApiPropertyOptional({
    description: 'Required when rejecting: what the contributor should change.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
