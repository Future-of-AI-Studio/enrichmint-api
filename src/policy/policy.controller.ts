import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { PolicyService } from './policy.service';

@ApiTags('Stewardship')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('stewardship-log')
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Get()
  @ApiOperation({
    summary:
      'Signed-in user: plain-language list of times the system intervened for me',
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.policy.listForUser(user.id);
  }
}
