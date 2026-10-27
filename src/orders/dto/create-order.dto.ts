import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ enum: ['GUIDE', 'REQUEST'] })
  @IsIn(['GUIDE', 'REQUEST'])
  kind: 'GUIDE' | 'REQUEST';

  @ApiPropertyOptional({ description: 'Required when kind is GUIDE.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  guideId?: string;

  @ApiPropertyOptional({ description: 'Required when kind is REQUEST.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  requestId?: string;

  @ApiPropertyOptional({
    description: 'The goal whose budget this purchase counts against.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  goalId?: string;

  @ApiProperty({
    description:
      'Must be true: the buyer reviewed the price and approved this payment.',
  })
  @IsBoolean()
  approved: boolean;
}
