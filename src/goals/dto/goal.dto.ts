import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGoalDto {
  @ApiProperty({
    example:
      'My support role is changing because of AI. I want to explore freelancing but I do not know where to start. I have weekends free.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  text: string;

  @ApiProperty({
    example: 2000,
    description: 'Total you are willing to spend on this goal, in cents.',
  })
  @IsInt()
  @Min(0)
  @Max(1000000)
  budgetCents: number;
}

export class GoalMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;
}

export class UpdateBudgetDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(1000000)
  budgetCents: number;
}
