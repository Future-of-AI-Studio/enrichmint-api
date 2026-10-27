import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AnswerDto {
  @ApiProperty({ example: 'situation' })
  @IsString()
  @MaxLength(40)
  key: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(6000)
  answer: string;

  @ApiPropertyOptional({
    description: 'True when this answers the follow-up question for `key`.',
  })
  @IsOptional()
  @IsBoolean()
  isFollowUp?: boolean;
}

export class DraftGuideDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  categoryId: string;

  @ApiPropertyOptional({
    description: 'Guide price in cents. Can be changed before submitting.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  priceCents?: number;
}
