import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class DraftRequestDto {
  @ApiProperty({ description: 'The guide whose contributor you want to ask.' })
  @IsString()
  @MaxLength(40)
  guideId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  goalId?: string;
}

export class ContextItemDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  key: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  value: string;

  @ApiProperty({
    description:
      'Only items with share=true are ever shown to the contributor.',
  })
  @IsBoolean()
  share: boolean;
}

export class UpdateRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  desiredResponse?: string;

  @ApiPropertyOptional({ type: [ContextItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContextItemDto)
  contextItems?: ContextItemDto[];
}

export class ApproveDto {
  @ApiProperty({
    description:
      'Must be true: you reviewed what will be shared and the price.',
  })
  @IsBoolean()
  approved: boolean;
}

export class ReasonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class DeliverDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(12000)
  body: string;

  @ApiProperty({
    description:
      'Whether the learner’s AI assistant may read this response to help them apply it. It stays private either way.',
  })
  @IsBoolean()
  aiUseAllowed: boolean;
}
