import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ApplyContributorDto {
  @ApiProperty({
    example: 'Former support lead, now freelance onboarding consultant',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  headline: string;

  @ApiProperty({
    description: 'Your background in your own words. Shown on your guides.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  background: string;
}

export class UpdateContributorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  headline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  background?: string;

  @ApiPropertyOptional({
    description: 'PayPal (sandbox) email that receives payouts.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  payoutEmail?: string;

  @ApiPropertyOptional({
    description: 'Price of a personalized written response, in cents.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  responsePriceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptingRequests?: boolean;

  @ApiPropertyOptional({
    description: 'Hours you have to accept or decline a request.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(336)
  acceptanceWindowH?: number;

  @ApiPropertyOptional({
    description: 'Hours you have to deliver after payment is confirmed.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  deliveryH?: number;

  @ApiPropertyOptional({ description: 'Topics you will and will not answer.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  boundaries?: string;
}
