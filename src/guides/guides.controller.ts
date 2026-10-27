import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { ContributorGuard } from 'src/common/guards/contributor.guard';
import { OptionalAuthGuard } from 'src/common/guards/optional-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/types/authenticated-request.type';
import {
  ListGuidesQueryDto,
  ReviewDecisionDto,
  UpdateDraftDto,
  UpdateGuideSettingsDto,
} from './dto/guide.dto';
import { GuidesService } from './guides.service';
import { ReviewsService } from './reviews.service';

@ApiTags('Guides')
@Controller()
export class GuidesController {
  constructor(
    private readonly guides: GuidesService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get('guides')
  @ApiOperation({ summary: 'Public: browse published guides (previews only)' })
  list(@Query() query: ListGuidesQueryDto) {
    return this.guides.listPublic(query);
  }

  @Get('guides/by-slug/:slug')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Public: one guide preview (never the full content)',
  })
  get(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.guides.getPublic(slug, req.authenticatedUser);
  }

  @Get('guides/:id/content')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Buyer, owner or admin: full guide content. 403 not_entitled for everyone else.',
  })
  content(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.guides.getContent(user, id);
  }

  @Get('library')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Buyer: guides I have bought' })
  library(@CurrentUser() user: AuthenticatedUser) {
    return this.guides.library(user.id);
  }

  @Get('studio/guides')
  @UseGuards(AuthGuard, ContributorGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Contributor: my guides' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.guides.mine(user.contributorId!);
  }

  @Get('studio/guides/:id')
  @UseGuards(AuthGuard, ContributorGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Contributor: one guide with its newest draft and permission history',
  })
  owned(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.guides.getForOwner(user.contributorId!, id);
  }

  @Patch('studio/guides/:id/draft')
  @UseGuards(AuthGuard, ContributorGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Contributor: edit the draft (a reviewed version is frozen; this starts a new one)',
  })
  updateDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.guides.updateDraft(user.contributorId!, id, dto);
  }

  @Patch('studio/guides/:id/settings')
  @UseGuards(AuthGuard, ContributorGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Contributor: price, AI-assist permission, topics and category',
  })
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateGuideSettingsDto,
  ) {
    return this.guides.updateSettings(user, id, dto);
  }

  @Post('studio/guides/:id/submit')
  @UseGuards(AuthGuard, ContributorGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Contributor: send the draft for admin review' })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.guides.submit(user, id);
  }

  @Post('studio/guides/:id/unpublish')
  @UseGuards(AuthGuard, ContributorGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Contributor: stop selling (existing buyers keep reading access)',
  })
  unpublish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.guides.setListed(user, id, false);
  }

  @Post('studio/guides/:id/republish')
  @UseGuards(AuthGuard, ContributorGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Contributor: list an unpublished guide again' })
  republish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.guides.setListed(user, id, true);
  }

  @Get('admin/review-queue')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Admin: guide versions waiting for review' })
  queue() {
    return this.reviews.queue();
  }

  @Post('admin/guide-versions/:id/approve')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: approve and publish a guide version' })
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reviews.approve(user.id, id);
  }

  @Post('admin/guide-versions/:id/reject')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: reject a guide version with a note' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.reviews.reject(user.id, id, dto.note);
  }

  @Post('admin/guides/:id/remove')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: remove a guide for a policy violation (revokes access)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.reviews.remove(user.id, id, dto.note);
  }
}
