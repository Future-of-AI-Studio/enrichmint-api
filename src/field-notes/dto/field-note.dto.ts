import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class DraftFieldNoteDto {
  @ApiProperty({ enum: ['GUIDE', 'RESPONSE'] })
  @IsIn(['GUIDE', 'RESPONSE'])
  source: 'GUIDE' | 'RESPONSE';

  @ApiProperty({
    description: 'Guide id, or request id for a personal response.',
  })
  @IsString()
  @MaxLength(40)
  sourceId: string;
}

export class UpdateFieldNoteDto {
  @ApiProperty({ description: 'What you tried and what happened.' })
  @IsString()
  @MinLength(20)
  @MaxLength(1200)
  body: string;
}

export class PublishFieldNoteDto {
  @ApiProperty({
    description:
      'Must be true: you agree to publish this note on the guide page and to the assistant.',
  })
  @IsBoolean()
  approved: boolean;

  @ApiPropertyOptional({
    description:
      'PayPal (sandbox) email for field note shares, if you have none on file.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  payoutEmail?: string;
}

export class HideFieldNoteDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}
