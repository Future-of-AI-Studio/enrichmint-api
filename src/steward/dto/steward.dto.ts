import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class StartSessionDto {
  @ApiPropertyOptional({
    description:
      'An existing goal. Or send text and budgetCents to create one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  goalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  text?: string;

  @ApiPropertyOptional({ description: 'Total budget for the goal, in cents.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  budgetCents?: number;
}

export class StewardMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;
}
