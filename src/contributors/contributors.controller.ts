import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PayeeGuard } from 'src/common/guards/payee.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { ContributorsService } from './contributors.service';
import {
  ApplyContributorDto,
  UpdateContributorDto,
} from './dto/contributor.dto';

@ApiTags('Contributors')
@Controller()
export class ContributorsController {
  constructor(private readonly contributors: ContributorsService) {}

  @Post('contributors/apply')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Signed-in user: become a contributor (starts as pending review)',
  })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApplyContributorDto,
  ) {
    return this.contributors.apply(user.id, dto);
  }

  @Get('contributors/me')
  @UseGuards(AuthGuard, PayeeGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Contributor: my profile and request settings' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.contributors.me(user.contributorId!);
  }

  @Patch('contributors/me')
  @UseGuards(AuthGuard, PayeeGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Contributor: update profile, payout email and personalized-request settings',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateContributorDto,
  ) {
    return this.contributors.update(user.contributorId!, dto);
  }

  @Get('contributors/:id')
  @ApiOperation({
    summary: 'Public: an approved contributor and their published guides',
  })
  publicProfile(@Param('id') id: string) {
    return this.contributors.publicProfile(id);
  }

  @Get('admin/contributors')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Admin: contributors, optionally by status' })
  list(@Query('status') status?: 'PENDING' | 'APPROVED' | 'SUSPENDED') {
    return this.contributors.listForAdmin(status);
  }

  @Post('admin/contributors/:id/approve')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Admin: approve a contributor' })
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contributors.setStatus(user.id, id, 'APPROVED');
  }

  @Post('admin/contributors/:id/suspend')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Admin: suspend a contributor' })
  suspend(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contributors.setStatus(user.id, id, 'SUSPENDED');
  }
}
